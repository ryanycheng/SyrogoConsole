package server

import (
	"bufio"
	"bytes"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("INDEX"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "assets/app.js"), []byte("APP"), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

func handler(t *testing.T, root, core string) http.Handler {
	t.Helper()
	u, err := url.Parse(core)
	if err != nil {
		t.Fatal(err)
	}
	h, err := New(root, u, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func TestStaticHealthAndFallback(t *testing.T) {
	h := handler(t, testRoot(t), "http://127.0.0.1:1")
	for _, tc := range []struct {
		path        string
		status      int
		body, cache string
	}{
		{"/healthz", 200, "ok\n", "no-store"},
		{"/", 200, "INDEX", "no-cache"},
		{"/clients/one", 200, "INDEX", "no-cache"},
		{"/assets/app.js", 200, "APP", "immutable"},
		{"/assets/missing.js", 404, "", ""},
		{"/favicon.ico", 404, "", ""},
	} {
		t.Run(tc.path, func(t *testing.T) {
			r := httptest.NewRecorder()
			h.ServeHTTP(r, httptest.NewRequest(http.MethodGet, tc.path, nil))
			if r.Code != tc.status {
				t.Fatalf("status = %d", r.Code)
			}
			if tc.body != "" && r.Body.String() != tc.body {
				t.Fatalf("body = %q", r.Body.String())
			}
			if tc.cache != "" && !strings.Contains(r.Header().Get("Cache-Control"), tc.cache) {
				t.Fatalf("cache = %q", r.Header().Get("Cache-Control"))
			}
		})
	}
}

func TestProxyPreservesRequestAndStreams(t *testing.T) {
	seen := make(chan *http.Request, 1)
	body := make(chan string, 1)
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen <- r.Clone(r.Context())
		data, _ := io.ReadAll(r.Body)
		body <- string(data)
		w.Header().Set("X-Core", "yes")
		flusher := w.(http.Flusher)
		_, _ = io.WriteString(w, "first\n")
		flusher.Flush()
		time.Sleep(20 * time.Millisecond)
		_, _ = io.WriteString(w, "second\n")
	}))
	defer core.Close()
	h := handler(t, testRoot(t), core.URL)

	proxy := httptest.NewServer(h)
	defer proxy.Close()
	req, _ := http.NewRequest(http.MethodPatch, proxy.URL+"/admin/config?dry=true", bytes.NewBufferString("payload"))
	req.Header.Set("Authorization", "Bearer secret")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	reader := bufio.NewReader(resp.Body)
	line, err := reader.ReadString('\n')
	if err != nil || line != "first\n" {
		t.Fatalf("first stream chunk = %q, %v", line, err)
	}
	rest, _ := io.ReadAll(reader)
	if string(rest) != "second\n" {
		t.Fatalf("rest = %q", rest)
	}
	r := <-seen
	if r.Method != http.MethodPatch || r.URL.Path != "/admin/config" || r.URL.RawQuery != "dry=true" {
		t.Fatalf("request changed: %s %s", r.Method, r.URL.String())
	}
	if r.Header.Get("Authorization") != "Bearer secret" || <-body != "payload" || resp.Header.Get("X-Core") != "yes" {
		t.Fatal("request or response not preserved")
	}
}

func TestProxyFailureDoesNotLeakError(t *testing.T) {
	h := handler(t, testRoot(t), "http://127.0.0.1:1")
	r := httptest.NewRecorder()
	h.ServeHTTP(r, httptest.NewRequest(http.MethodGet, "/admin/status", nil))
	if r.Code != http.StatusBadGateway || r.Body.String() != "bad gateway\n" {
		t.Fatalf("response = %d %q", r.Code, r.Body.String())
	}
	if strings.Contains(strings.ToLower(r.Body.String()), "connect") {
		t.Fatal("internal error leaked")
	}
}

func TestNewValidatesInputs(t *testing.T) {
	u, _ := url.Parse("file:///tmp/core")
	if _, err := New(t.TempDir(), u, nil); err == nil {
		t.Fatal("expected invalid URL error")
	}
	httpURL, _ := url.Parse("http://localhost")
	if _, err := New(filepath.Join(t.TempDir(), "missing"), httpURL, nil); err == nil {
		t.Fatal("expected root error")
	}
}
