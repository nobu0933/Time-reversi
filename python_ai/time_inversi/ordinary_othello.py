"""Ordinary 6x6 Othello, independent of TIME REVERSI's corner inversions."""
from dataclasses import dataclass
from .rules import BLACK, WHITE, PASS, flips, moves


@dataclass(frozen=True)
class Position:
    board: tuple[int, ...]
    player: int
    passed: bool = False

    def __post_init__(self):
        if len(self.board) != 36 or any(v not in (BLACK, WHITE, 0) for v in self.board):
            raise ValueError('Expected a 6x6 board containing only -1, 0 and 1')
        if self.player not in (BLACK, WHITE):
            raise ValueError('Player must be -1 or 1')


def legal(position):
    return moves(position.board, position.player) or (PASS,)


def terminal(position):
    if moves(position.board, position.player):
        return False
    return position.passed or not moves(position.board, -position.player)


def play(position, action):
    available = legal(position)
    if action not in available:
        raise ValueError(f'Illegal ordinary Othello action: {action}')
    if action == PASS:
        return Position(position.board, -position.player, True)
    board = list(position.board)
    board[action] = position.player
    for square in flips(position.board, action, position.player):
        board[square] = position.player
    return Position(tuple(board), -position.player)


def stone_difference(position):
    return position.board.count(position.player) - position.board.count(-position.player)
