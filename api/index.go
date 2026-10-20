// Package handler is the Vercel Go function. vercel.json rewrites every
// /api/* path here; the chi router dispatches on the original path.
package handler

import (
	"net/http"
	"sync"

	"github.com/mkerkstra/pdf2excel/backend/server"
)

var (
	once sync.Once
	h    http.Handler
)

func Handler(w http.ResponseWriter, r *http.Request) {
	once.Do(func() { h = server.New(server.ConfigFromEnv()).Router() })
	h.ServeHTTP(w, r)
}
