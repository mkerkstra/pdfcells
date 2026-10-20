// Command server runs the API locally on :8080 (Vite proxies /api to it).
package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/mkerkstra/pdfcells/backend/server"
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
		ReadTimeout:       60 * time.Second,
		// extract may run for up to 280s; leave headroom to write the reply.
		WriteTimeout:   300 * time.Second,
		IdleTimeout:    120 * time.Second,
		MaxHeaderBytes: 64 << 10,
	}
	log.Printf("api listening on http://localhost:%s", port)
	log.Fatal(srv.ListenAndServe())
}
