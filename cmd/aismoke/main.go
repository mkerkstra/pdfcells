// Command aismoke sends one rendered page through the real extraction path and
// prints the tables, usage and cost. Usage: go run ./cmd/aismoke page.jpg [tier]
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/mkerkstra/pdfcells/backend/extract"
	"github.com/mkerkstra/pdfcells/backend/pricing"
)

func main() {
	if len(os.Args) < 2 {
		log.Fatal("usage: aismoke page.jpg [fast|accurate|max]")
	}
	img, err := os.ReadFile(os.Args[1])
	if err != nil {
		log.Fatal(err)
	}
	tier := extract.TierFast
	if len(os.Args) > 2 {
		tier = extract.Tier(os.Args[2])
	}
	req := extract.Request{Tier: tier, ImageBase64: base64.StdEncoding.EncodeToString(img), MediaType: "image/jpeg", PageNumber: 1}
	if err := req.Validate(); err != nil {
		log.Fatal(err)
	}
	est, _ := req.EstimateInputTokens()
	start := time.Now()
	res, err := extract.Run(context.Background(), os.Getenv("ANTHROPIC_API_KEY"), req)
	if res != nil {
		out, _ := json.MarshalIndent(res, "", "  ")
		fmt.Println(string(out))
		for _, u := range res.Usage {
			fmt.Printf("usage: %+v\n", u)
		}
		fmt.Printf("estimate %d input tokens (hold basis); actual %d in / %d out; cost %d µ$ → charged %d µ$ at 15%%; %s\n",
			est, res.Input, res.Output, res.Cost, pricing.WithMarkup(res.Cost, 1500), time.Since(start).Round(time.Millisecond))
	}
	if err != nil {
		log.Fatal(err)
	}
}
