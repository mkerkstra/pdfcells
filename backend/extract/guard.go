package extract

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"unicode/utf8"
)

// Limits for hosted (server-paid) requests. They are loose for real PDF pages
// and tight enough that /api/extract is useless as a general-purpose LLM
// proxy. Bring-your-own-key requests are billed to the caller and skip them.
const (
	HostedMaxTextLayer   = 20_000 // characters
	HostedMaxInstruction = 500    // characters
	HostedMaxCurrentCell = 5_000  // cells across all correction tables
	HostedMaxCurrentText = 48_000
	HostedMaxCurrentJSON = 64 << 10 // serialized bytes, structure included
	HostedMaxTables      = 20       // correction tables (one page's worth)
	HostedMaxRows        = 2_000    // rows across correction tables
	HostedMinLongSide    = 400      // px
	// FreeMaxOutputTokens caps a free (Fast) page; dense ledgers fit easily.
	FreeMaxOutputTokens = 6_000
	// MaxCellRunes and MaxOutputCells bound what a hosted response returns.
	MaxCellRunes   = 500
	MaxOutputCells = 5_000
	// maxPixels rejects decompression bombs before a full decode.
	maxPixels = 40_000_000
)

// ErrNotAPage means the image is too small or blank to be a document page.
var ErrNotAPage = errors.New("the image doesn't look like a document page")

// ValidateHosted applies the hosted-only caps. Call it after Validate and
// before reserving any money: it fully decodes the image.
func (r *Request) ValidateHosted() error {
	if n := utf8.RuneCountInString(r.TextLayer); n > HostedMaxTextLayer {
		return fmt.Errorf("text layer too long (%d characters, max %d)", n, HostedMaxTextLayer)
	}
	if n := utf8.RuneCountInString(r.Instruction); n > HostedMaxInstruction {
		return fmt.Errorf("instruction too long (%d characters, max %d)", n, HostedMaxInstruction)
	}
	if len(r.Current) > HostedMaxTables {
		return fmt.Errorf("too many correction tables (%d, max %d)", len(r.Current), HostedMaxTables)
	}
	cells, rows, text := 0, 0, 0
	for _, t := range r.Current {
		text += len(t.Title) + len(t.Notes)
		rows += len(t.Rows)
		for _, row := range t.Rows {
			cells += len(row)
			for _, c := range row {
				text += len(c)
			}
		}
	}
	if cells > HostedMaxCurrentCell || rows > HostedMaxRows || text > HostedMaxCurrentText {
		return fmt.Errorf("current tables too large for a correction (max %d cells)", HostedMaxCurrentCell)
	}
	// Bound the serialized form too: thousands of empty tables or rows count
	// as zero cells but still expand the prompt.
	if len(r.Current) > 0 {
		if b, err := json.Marshal(r.Current); err != nil || len(b) > HostedMaxCurrentJSON {
			return fmt.Errorf("current tables too large for a correction (max %d KB)", HostedMaxCurrentJSON>>10)
		}
	}
	raw, err := base64.StdEncoding.DecodeString(r.ImageBase64)
	if err != nil {
		return fmt.Errorf("image is not valid base64: %w", err)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("image could not be decoded: %w", err)
	}
	if cfg.Width*cfg.Height > maxPixels {
		return fmt.Errorf("page image has too many pixels (%dx%d)", cfg.Width, cfg.Height)
	}
	if max(cfg.Width, cfg.Height) < HostedMinLongSide {
		return fmt.Errorf("%w: %dx%d is below %d px on the long side", ErrNotAPage, cfg.Width, cfg.Height, HostedMinLongSide)
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("image could not be decoded: %w", err)
	}
	if blank(img) {
		return fmt.Errorf("%w: it is blank", ErrNotAPage)
	}
	return nil
}

// blank reports whether the image is confidently uniform: essentially no
// sampled pixel differs from the dominant tone by more than JPEG noise. It
// errs towards accepting, so a page with a few faint glyphs still passes.
func blank(img image.Image) bool {
	b := img.Bounds()
	stride := 1
	for (b.Dx()/stride)*(b.Dy()/stride) > 400_000 {
		stride++
	}
	var hist [256]int
	lum := make([]uint8, 0, (b.Dx()/stride+1)*(b.Dy()/stride+1))
	for y := b.Min.Y; y < b.Max.Y; y += stride {
		for x := b.Min.X; x < b.Max.X; x += stride {
			r, g, bl, _ := img.At(x, y).RGBA()
			l := uint8((299*r + 587*g + 114*bl) / 1000 >> 8)
			hist[l]++
			lum = append(lum, l)
		}
	}
	mode := 0
	for i, n := range hist {
		if n > hist[mode] {
			mode = i
		}
	}
	ink := 0
	for _, l := range lum {
		if d := int(l) - mode; d > 24 || d < -24 {
			ink++
		}
	}
	return ink < 8
}

// Clamp bounds a hosted response: cells longer than MaxCellRunes are cut and
// anything past MaxOutputCells is dropped. It returns how many cells were
// truncated and dropped so callers can log counts (never content).
func Clamp(res *Result) (truncated, dropped int) {
	if res == nil {
		return 0, 0
	}
	total := 0
	out := res.Tables[:0]
	for _, t := range res.Tables {
		keep := t.Rows[:0]
		for _, row := range t.Rows {
			if total+len(row) > MaxOutputCells {
				dropped += len(row)
				continue
			}
			total += len(row)
			for i, c := range row {
				if utf8.RuneCountInString(c) > MaxCellRunes {
					row[i] = string([]rune(c)[:MaxCellRunes])
					truncated++
				}
			}
			keep = append(keep, row)
		}
		if len(keep) == 0 {
			continue
		}
		t.Rows = keep
		t.HeaderRows = min(t.HeaderRows, len(keep))
		out = append(out, t)
	}
	res.Tables = out
	return truncated, dropped
}
