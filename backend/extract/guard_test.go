package extract

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"strings"
	"testing"
)

// pageJPEG renders a white page, optionally with one short line of "text"
// (a few dark glyph-sized blocks) like the sparsest real page.
func pageJPEG(t *testing.T, w, h int, ink bool) string {
	t.Helper()
	img := image.NewGray(image.Rect(0, 0, w, h))
	for i := range img.Pix {
		img.Pix[i] = 255
	}
	if ink {
		for g := range 12 { // 12 glyphs, 14x20 px each, 4px strokes
			x0 := 100 + g*20
			for y := 100; y < 120; y++ {
				for x := x0; x < x0+14; x++ {
					if x-x0 < 4 || y-100 < 4 {
						img.SetGray(x, y, color.Gray{Y: 20})
					}
				}
			}
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 85}); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

func TestValidateHosted(t *testing.T) {
	page := pageJPEG(t, 1545, 2000, true)
	ok := Request{Tier: TierFast, ImageBase64: page, TextLayer: strings.Repeat("1,234.56\t", 2000)}
	if err := ok.ValidateHosted(); err != nil {
		t.Fatalf("a sparse real-looking page was rejected: %v", err)
	}
	big := [][]string{make([]string, HostedMaxCurrentCell+1)}
	for name, r := range map[string]Request{
		"text layer":  {ImageBase64: page, TextLayer: strings.Repeat("é", HostedMaxTextLayer+1)},
		"instruction": {ImageBase64: page, Instruction: strings.Repeat("x", HostedMaxInstruction+1)},
		"current":     {ImageBase64: page, Current: []Table{{Rows: big}}},
		"not image":   {ImageBase64: "aGk="},
	} {
		if err := r.ValidateHosted(); err == nil {
			t.Errorf("%s: expected rejection", name)
		}
	}
	for name, img := range map[string]string{
		"blank": pageJPEG(t, 1545, 2000, false),
		"tiny":  pageJPEG(t, 300, 390, true),
	} {
		r := Request{ImageBase64: img}
		if err := r.ValidateHosted(); !errors.Is(err, ErrNotAPage) {
			t.Errorf("%s: want ErrNotAPage, got %v", name, err)
		}
	}
}

func TestClamp(t *testing.T) {
	long := strings.Repeat("ü", MaxCellRunes+10)
	row := func(n int) []string { return make([]string, n) }
	res := &Result{Tables: []Table{
		{HeaderRows: 1, Rows: [][]string{{long, "ok"}, row(2)}},
		{Rows: append([][]string{}, func() [][]string {
			var rs [][]string
			for range MaxOutputCells / 10 {
				rs = append(rs, row(10))
			}
			return rs
		}()...)},
	}}
	truncated, dropped := Clamp(res)
	if truncated != 1 || []rune(res.Tables[0].Rows[0][0])[MaxCellRunes-1] != 'ü' || len([]rune(res.Tables[0].Rows[0][0])) != MaxCellRunes {
		t.Fatalf("truncated=%d cell=%d runes", truncated, len([]rune(res.Tables[0].Rows[0][0])))
	}
	cells := 0
	for _, tb := range res.Tables {
		for _, r := range tb.Rows {
			cells += len(r)
		}
	}
	if cells > MaxOutputCells || dropped == 0 {
		t.Fatalf("cells=%d dropped=%d", cells, dropped)
	}
	if cells+dropped != 4+MaxOutputCells {
		t.Fatalf("cells+dropped=%d, want %d", cells+dropped, 4+MaxOutputCells)
	}
}
