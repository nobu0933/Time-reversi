"""Local browser game server with the trained PRO opponent."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from threading import Lock
from urllib.parse import urlsplit

import numpy as np
import torch

from .checkpoint import device_for, load
from .mcts import MCTS
from .rules import State, legal_actions


ROOT = Path(__file__).resolve().parents[2]
STATIC = {
    '/': 'index.html', '/index.html': 'index.html',
    '/styles/style.css': 'styles/style.css',
    '/src/game/rules.js': 'src/game/rules.js',
    '/src/game/replay.js': 'src/game/replay.js',
    '/src/ui/game.js': 'src/ui/game.js',
    '/src/ai/client.js': 'src/ai/client.js',
    '/src/ai/worker.js': 'src/ai/worker.js',
    '/src/ai/network.js': 'src/ai/network.js',
    '/src/ai/search.js': 'src/ai/search.js',
    '/assets/ai/model.js': 'assets/ai/model.js',
    '/assets/ai/pro-model.js': 'assets/ai/pro-model.js',
    '/assets/icon/bgm-on.svg': 'assets/icon/bgm-on.svg',
    '/assets/icon/bgm-off.svg': 'assets/icon/bgm-off.svg',
    '/assets/icon/time-inversion-forward.svg': 'assets/icon/time-inversion-forward.svg',
    '/assets/icon/time-inversion-reverse.svg': 'assets/icon/time-inversion-reverse.svg',
    '/assets/icon/pocket-watch-frame.svg': 'assets/icon/pocket-watch-frame.svg',
    '/assets/icon/pocket-watch-hand.svg': 'assets/icon/pocket-watch-hand.svg',
    '/assets/icon/replay.svg': 'assets/icon/replay.svg',
    '/assets/icon/pause.svg': 'assets/icon/pause.svg',
    '/assets/icon/reset.svg': 'assets/icon/reset.svg',
    '/assets/icon/undo.svg': 'assets/icon/undo.svg',
    '/assets/sounds/put.mp3': 'assets/sounds/put.mp3',
    '/assets/sounds/switch.mp3': 'assets/sounds/switch.mp3',
    '/assets/sounds/pass.mp3': 'assets/sounds/pass.mp3',
    '/assets/sounds/put-reverse.wav': 'assets/sounds/put-reverse.wav',
    '/assets/sounds/time-reversal.wav': 'assets/sounds/time-reversal.wav',
}
for name in ('komorebi_orgel', 'tsukikage_orgel'):
    for suffix in ('', '_150x_reverse', '_150x', '_200x_reverse', '_200x'):
        path = f'assets/sounds/{name}{suffix}.mp3'
        STATIC['/' + path] = path
MIME = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav'}
MAX_BODY = 128 * 1024


def choose_action(model, state, simulations, rng):
    if state.ended:
        raise ValueError('Game has ended')
    policy = MCTS(model, rng).search(state, simulations=simulations, noise=False)
    candidates = np.flatnonzero(policy == policy.max())
    return int(rng.choice(candidates))


def make_handler(model, simulations, rng):
    inference_lock = Lock()

    class Handler(BaseHTTPRequestHandler):
        def respond(self, status, payload):
            encoded = json.dumps(payload).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(encoded)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(encoded)

        def do_GET(self):
            route = urlsplit(self.path).path
            if route == '/api/pro/status':
                return self.respond(200, {'ready': True, 'simulations': simulations})
            name = STATIC.get(route)
            if name is None:
                return self.respond(404, {'error': 'Not found'})
            path = ROOT / name
            try:
                data = path.read_bytes()
            except FileNotFoundError:
                return self.respond(404, {'error': 'Not found'})
            self.send_response(200)
            self.send_header('Content-Type', MIME[path.suffix])
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            if urlsplit(self.path).path != '/api/pro/move':
                return self.respond(404, {'error': 'Not found'})
            if self.headers.get_content_type() != 'application/json':
                return self.respond(415, {'error': 'Expected JSON'})
            try:
                size = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                return self.respond(400, {'error': 'Invalid request length'})
            if not 0 < size <= MAX_BODY:
                return self.respond(413, {'error': 'Request is empty or too large'})
            try:
                payload = json.loads(self.rfile.read(size))
                state = State.from_dict(payload['state'])
                if len(state.board) != 36 or len(state.origins) != 36 or state.player not in (1, -1):
                    raise ValueError('Invalid game state')
                if state.direction not in (1, -1) or state.ended:
                    raise ValueError('Game has ended or is invalid')
                with inference_lock:
                    action = choose_action(model, state, simulations, rng)
                if action not in legal_actions(state):
                    raise ValueError('Model returned an illegal action')
            except (KeyError, TypeError, ValueError, IndexError) as error:
                return self.respond(400, {'error': str(error)})
            return self.respond(200, {'action': action, 'index': None if action == 36 else action})

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkpoint', type=Path,
                        default=ROOT / 'python_ai' / 'runs' / 'experiment01' / 'latest.pt')
    parser.add_argument('--simulations', type=int, default=64)
    parser.add_argument('--port', type=int, default=4173)
    parser.add_argument('--device', choices=('auto', 'cpu', 'cuda'), default='cpu')
    parser.add_argument('--threads', type=int, default=2)
    args = parser.parse_args()
    if args.simulations < 1 or args.threads < 1 or not 0 < args.port < 65536:
        parser.error('Invalid simulations, threads or port')
    torch.set_num_threads(args.threads)
    model, data = load(args.checkpoint, device_for(args.device))
    rng = np.random.default_rng()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(model, args.simulations, rng))
    print(f'PRO ready: iteration {data["iteration"]}, {args.simulations} simulations', flush=True)
    print(f'Open http://127.0.0.1:{args.port}/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
