"""Paired TIME REVERSI matches between two trained checkpoints."""
import argparse
import json
import numpy as np
from .checkpoint import device_for, load
from .mcts import MCTS
from .rules import BLACK, WHITE, PASS, advance, counts, create_game, outcome


def compare(candidate, incumbent, games=20, simulations=64, seed=1234, max_moves=512):
    if games < 2 or games % 2:
        raise ValueError('games must be even and at least 2')
    rng = np.random.default_rng(seed)
    rows = []
    for game in range(games):
        candidate_color = BLACK if game % 2 == 0 else WHITE
        state = create_game()
        agents = {candidate_color: MCTS(candidate, rng, max_depth=max_moves),
                  -candidate_color: MCTS(incumbent, rng, max_depth=max_moves)}
        inversions = passes = reverse_turns = 0
        for turn_number in range(1, max_moves + 1):
            policy = agents[state.player].search(state, simulations, noise=False)
            action = int(rng.choice(np.flatnonzero(policy == policy.max())))
            transition = advance(state, None if action == PASS else action)
            if transition is None:
                raise RuntimeError('Search chose an illegal action')
            passes += int(action == PASS)
            reverse_turns += int(state.direction == -1)
            inversions += int(transition.corner_inversion is not None)
            state = transition.state
            if state.ended:
                rows.append(dict(game=game + 1, candidate_color=candidate_color,
                                 result=outcome(state, candidate_color), turns=turn_number,
                                 black=counts(state)[0], white=counts(state)[1],
                                 passes=passes, inversions=inversions,
                                 reverse_turns=reverse_turns))
                break
        else:
            raise RuntimeError('Comparison game exceeded max_moves; no result recorded')
    wins = sum(row['result'] == 1 for row in rows)
    draws = sum(row['result'] == 0 for row in rows)
    return dict(games=games, simulations=simulations, wins=wins, draws=draws,
                losses=games-wins-draws, score_rate=(wins + draws / 2) / games,
                by_color={name: {label: sum(r['candidate_color'] == color and r['result'] == result
                                        for r in rows)
                                 for label, result in (('wins', 1), ('draws', 0), ('losses', -1))}
                          for name, color in (('black', BLACK), ('white', WHITE))},
                games_with_inversion=sum(r['inversions'] > 0 for r in rows),
                games_with_reverse=sum(r['reverse_turns'] > 0 for r in rows),
                results=rows)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--incumbent', required=True)
    parser.add_argument('--games', type=int, default=20)
    parser.add_argument('--simulations', type=int, default=64)
    parser.add_argument('--seed', type=int, default=1234)
    parser.add_argument('--max-moves', type=int, default=512)
    parser.add_argument('--device', choices=('auto', 'cpu', 'cuda'), default='auto')
    args = parser.parse_args(argv)
    import torch
    torch.set_num_threads(2)
    device = device_for(args.device)
    candidate, _ = load(args.candidate, device)
    incumbent, _ = load(args.incumbent, device)
    print(json.dumps(compare(candidate, incumbent, args.games, args.simulations,
                             args.seed, args.max_moves), indent=2))


if __name__ == '__main__':
    main()
