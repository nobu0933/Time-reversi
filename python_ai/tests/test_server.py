import json
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from threading import Thread
import unittest

import numpy as np

from time_inversi.mcts import UniformEvaluator
from time_inversi.rules import create_game, legal_actions
from time_inversi.serve import STATIC, make_handler


class BrowserServerTests(unittest.TestCase):
    def test_browser_pro_model_is_served(self):
        self.assertEqual(STATIC['/assets/ai/pro-model.js'], 'assets/ai/pro-model.js')

    def test_serves_game_and_returns_legal_pro_move(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0),
                                     make_handler(UniformEvaluator(), 4, np.random.default_rng(7)))
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            connection = HTTPConnection('127.0.0.1', server.server_port, timeout=10)
            try:
                connection.request('GET', '/')
            except PermissionError:
                self.skipTest('Localhost sockets are restricted in this execution environment')
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertIn(b'TIME REVERSI', response.read())
            connection.request('GET', '/python_ai/runs/experiment01/latest.pt')
            response = connection.getresponse()
            self.assertEqual(response.status, 404)
            response.read()
            connection.request('GET', '/api/pro/status')
            response = connection.getresponse()
            self.assertEqual(json.loads(response.read()), {'ready': True, 'simulations': 4})
            state = create_game()
            connection.request('POST', '/api/pro/move', json.dumps({'state': state.to_dict()}),
                               {'Content-Type': 'application/json'})
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            result = json.loads(response.read())
            self.assertIn(result['action'], legal_actions(state))
            self.assertEqual(result['index'], result['action'])
            connection.request('POST', '/api/pro/move', '{}', {'Content-Type': 'application/json'})
            response = connection.getresponse()
            self.assertEqual(response.status, 400)
            response.read()
            connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
