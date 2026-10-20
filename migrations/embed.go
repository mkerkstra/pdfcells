// Package migrations embeds the SQL migrations applied at startup.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
