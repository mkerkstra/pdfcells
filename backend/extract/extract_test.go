package extract

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/jpeg"
	"strings"
	"testing"
)

func jpegB64(t *testing.T, w, h int) string {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, image.NewGray(image.Rect(0, 0, w, h)), nil); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

func TestValidate(t *testing.T) {
	ok := Request{Tier: TierFast, ImageBase64: "aGk="}
	if err := ok.Validate(); err != nil || ok.MediaType != "image/jpeg" {
		t.Fatalf("valid request rejected: %v (media %q)", err, ok.MediaType)
	}
	for name, r := range map[string]Request{
		"tier":  {Tier: "turbo"},
		"media": {Tier: TierFast, MediaType: "application/pdf"},
		"size":  {Tier: TierFast, ImageBase64: strings.Repeat("A", MaxImageBytes*2)},
	} {
		if err := r.Validate(); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}

func TestEstimateInputTokens(t *testing.T) {
	r := Request{Tier: TierFast, ImageBase64: jpegB64(t, 1500, 2000), TextLayer: strings.Repeat("x", 3000)}
	n, err := r.EstimateInputTokens()
	if err != nil {
		t.Fatal(err)
	}
	// 1500×2000/750×2 = 8000 image + 1500 text + 3000 overhead
	if n != 12_500 {
		t.Fatalf("estimate %d", n)
	}
	if _, err := (&Request{ImageBase64: "bm90IGFuIGltYWdl"}).EstimateInputTokens(); err == nil {
		t.Fatal("expected decode error for non-image")
	}
}

func TestNormalizeTables(t *testing.T) {
	got := normalizeTables([]Table{
		{Rows: [][]string{{"a", "b", "c"}, {"d"}}, HeaderRows: 5},
		{Rows: [][]string{}},
	})
	if len(got) != 1 {
		t.Fatalf("empty table should be dropped, got %d", len(got))
	}
	if len(got[0].Rows[1]) != 3 || got[0].HeaderRows != 2 {
		t.Fatalf("not normalised: %+v", got[0])
	}
}

func TestUserPrompt(t *testing.T) {
	scan := userPrompt(Request{PageNumber: 2})
	if !strings.Contains(scan, "no text layer") {
		t.Error("scan prompt should say there is no text layer")
	}
	untrusted := userPrompt(Request{TextLayer: "Total 12", TextLayerTrusted: false})
	if !strings.Contains(untrusted, "UNTRUSTED") {
		t.Error("untrusted text layer must be labelled")
	}
	fix := userPrompt(Request{Current: []Table{{Rows: [][]string{{"x"}}}}, Instruction: "split column B"})
	if !strings.Contains(fix, "<current_tables>") || !strings.Contains(fix, "split column B") {
		t.Error("correction prompt must include current tables and instruction")
	}
}
