package server

import (
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// New returns the Console HTTP handler. Admin requests are relayed without
// rewriting their method, URL, headers, or body.
func New(root string, coreURL *url.URL, logger *slog.Logger) (http.Handler, error) {
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("invalid web root %q", root)
	}
	if coreURL == nil || (coreURL.Scheme != "http" && coreURL.Scheme != "https") || coreURL.Host == "" {
		return nil, errors.New("core URL must be an absolute HTTP URL")
	}
	if logger == nil {
		logger = slog.Default()
	}

	proxy := httputil.NewSingleHostReverseProxy(coreURL)
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		logger.Error("core proxy failed", "path", r.URL.Path, "error", err)
		http.Error(w, "bad gateway", http.StatusBadGateway)
	}
	proxy.ModifyResponse = func(resp *http.Response) error {
		resp.Header.Del("Server")
		return nil
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/healthz":
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("ok\n"))
		case r.URL.Path == "/admin" || strings.HasPrefix(r.URL.Path, "/admin/"):
			proxy.ServeHTTP(w, r)
		default:
			serveSPA(w, r, root)
		}
	}), nil
}

func serveSPA(w http.ResponseWriter, r *http.Request, root string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	clean := path.Clean("/" + r.URL.Path)
	rel := strings.TrimPrefix(clean, "/")
	if rel == "" {
		rel = "index.html"
	}
	file := filepath.Join(root, filepath.FromSlash(rel))
	if !withinRoot(root, file) {
		http.NotFound(w, r)
		return
	}
	info, err := os.Stat(file)
	if err == nil && info.Mode().IsRegular() {
		serveFile(w, r, file, rel)
		return
	}
	if strings.HasPrefix(rel, "assets/") || path.Ext(rel) != "" {
		http.NotFound(w, r)
		return
	}
	index := filepath.Join(root, "index.html")
	if _, err := os.Stat(index); err != nil {
		http.NotFound(w, r)
		return
	}
	serveFile(w, r, index, "index.html")
}

func serveFile(w http.ResponseWriter, r *http.Request, file, name string) {
	if name == "index.html" {
		w.Header().Set("Cache-Control", "no-cache")
	} else if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}
	if contentType := mime.TypeByExtension(filepath.Ext(name)); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	http.ServeFile(w, r, file)
}

func withinRoot(root, file string) bool {
	rel, err := filepath.Rel(root, file)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
