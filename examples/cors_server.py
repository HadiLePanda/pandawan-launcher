import http.server
import socketserver
import os
import sys

PORT = int(os.environ.get("PORT", "8765"))

class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

if __name__ == "__main__":
    directory = os.path.dirname(os.path.abspath(__file__))
    os.chdir(directory)
    with socketserver.TCPServer(("", PORT), CORSRequestHandler) as httpd:
        print(f"Pandawan local example server (CORS enabled)")
        print(f"URL: http://localhost:{PORT}")
        print(f"Root: {directory}")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
            sys.exit(0)
