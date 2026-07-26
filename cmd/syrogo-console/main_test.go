package main

import "testing"

func TestTLSArgumentsMustBePaired(t *testing.T) {
	for _, args := range [][]string{{"--tls-cert", "cert.pem"}, {"--tls-key", "key.pem"}} {
		if err := run(args); err == nil || err.Error() != "--tls-cert and --tls-key must be provided together" {
			t.Fatalf("run(%v) error = %v", args, err)
		}
	}
}
