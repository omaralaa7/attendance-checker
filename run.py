"""Start دفتر الغياب: python run.py"""
import threading
import webbrowser

import uvicorn

HOST, PORT = "127.0.0.1", 8000

if __name__ == "__main__":
    url = f"http://{HOST}:{PORT}"
    print(f"دفتر الغياب شغال على {url}  (اقفل الشباك ده أو دوس Ctrl+C علشان توقفه)")
    threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run("app.main:app", host=HOST, port=PORT, log_level="warning")
