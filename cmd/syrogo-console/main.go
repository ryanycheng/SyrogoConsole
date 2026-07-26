package main

import (
	"crypto/tls"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/ryanycheng/SyrogoConsole/internal/server"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	flags := flag.NewFlagSet("syrogo-console", flag.ContinueOnError)
	listen := flags.String("listen", "127.0.0.1:23233", "listen address")
	root := flags.String("root", "/opt/syrogo-console/dist", "web asset root")
	core := flags.String("core-url", "http://127.0.0.1:23234", "Syrogo Core base URL")
	cert := flags.String("tls-cert", "", "TLS certificate file")
	key := flags.String("tls-key", "", "TLS private key file")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if (*cert == "") != (*key == "") {
		return fmt.Errorf("--tls-cert and --tls-key must be provided together")
	}
	coreURL, err := url.Parse(*core)
	if err != nil {
		return fmt.Errorf("parse core URL: %w", err)
	}
	handler, err := server.New(*root, coreURL, slog.Default())
	if err != nil {
		return err
	}
	httpServer := &http.Server{
		Addr:              *listen,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		TLSConfig:         &tls.Config{MinVersion: tls.VersionTLS12},
	}
	if *cert != "" {
		return httpServer.ListenAndServeTLS(*cert, *key)
	}
	return httpServer.ListenAndServe()
}
