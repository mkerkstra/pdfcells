// Command server runs the API locally on :8080 (Vite proxies /api to it).
package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/mkerkstra/pdf2excel/internal/server"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           server.New(server.ConfigFromEnv()).Router(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("api listening on http://localhost:%s", port)
	log.Fatal(srv.ListenAndServe())
}
