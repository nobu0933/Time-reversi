"""Compare distilled models with exact *ordinary* 6x6 endgame moves.

The variant-derived positions are still solved under ordinary Othello rules.
This measures transfer of the ordinary teacher, not TIME REVERSI strength.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import torch

from .network import NetworkConfig, PolicyValueNet
from .ordinary_solver import solve
from .pretrain import candidate_states


def load_model(path):
    data = torch.load(path, map_location='cpu', weights_only=True)
    model = PolicyValueNet(NetworkConfig(**data['network_config']))
    model.load_state_dict(data['model'])
    return model.eval()


def positions(rng, group, count, minimum_empty, maximum_empty):
    selected = []
    attempts = 0
    while len(selected) < count and attempts < count * 10:
        attempts += 1
        games = (1, 0) if group == 'ordinary' else (0, 1)
        candidates = [(state, position) for state, position, _ in candidate_states(rng, *games)
                      if minimum_empty <= position.board.count(0) <= maximum_empty]
        if candidates:
            selected.append(candidates[int(rng.integers(len(candidates)))])
    if len(selected) < count:
        raise RuntimeError(f'Only {len(selected)} of {count} {group} positions found')
    return selected


def measure(models, selected, *, max_nodes=1_000_000, seconds=10):
    rows = []
    for state, position in selected:
        solution = solve(position, max_empty=position.board.count(0),
                         max_nodes=max_nodes, seconds=seconds)
        if solution is None:
            raise RuntimeError('Exact solution exceeded benchmark budget')
        outcomes = {}
        for name, model in models.items():
            policy, _ = model.predict(state)
            action = int(np.argmax(policy))
            outcomes[name] = dict(action=action,
                                  optimal=action in solution.best_actions,
                                  regret=solution.value - solution.action_values[action],
                                  missed_win=solution.value > 0 and
                                  solution.action_values[action] <= 0)
        rows.append(dict(empty=position.board.count(0), best=solution.best_actions,
                         exact_value=solution.value, models=outcomes))
    summary = {}
    for name in models:
        summary[name] = dict(optimal=sum(row['models'][name]['optimal'] for row in rows),
                             total=len(rows),
                             mean_stone_regret=sum(row['models'][name]['regret'] for row in rows) / len(rows),
                             missed_wins=sum(row['models'][name]['missed_win'] for row in rows))
    return dict(summary=summary, rows=rows)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', action='append', required=True, type=Path,
                        help='Repeat for each checkpoint to compare')
    parser.add_argument('--positions', type=int, default=100)
    parser.add_argument('--min-empty', type=int, default=4)
    parser.add_argument('--max-empty', type=int, default=6)
    parser.add_argument('--seed', type=int, default=20261023)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args(argv)
    torch.set_num_threads(2)
    models = {path.stem: load_model(path) for path in args.model}
    rng = np.random.default_rng(args.seed)
    groups = {group: measure(models, positions(rng, group, args.positions,
                                                args.min_empty, args.max_empty))
              for group in ('ordinary', 'time_inversi')}
    result = dict(seed=args.seed, empty_range=[args.min_empty, args.max_empty], groups=groups)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({group: data['summary'] for group, data in groups.items()}, indent=2))


if __name__ == '__main__':
    main()
