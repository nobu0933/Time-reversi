"""Distill an ordinary-Othello teacher into the TIME REVERSI policy/value net."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import torch
from .network import NetworkConfig, PolicyValueNet
from .ordinary_othello import Position, legal, play, terminal
from .ordinary_teacher import Teacher, load_pretrained
from .oracle_teacher import OracleEvaluator, OracleTeacher
from .oracle_opening import OracleOpening
from .rules import CORNERS, PASS, State, create_game, legal_actions, step
from .selfplay import Sample
from .train import train_batch

FORMAT = 'time-inversi-ordinary-pretrain-v1'


def ordinary_state(position, history):
    """Encode an ordinary Othello trajectory without triggering corner inversions."""
    origins = [0] * 36
    for action in history:
        if action is not None:
            origins[action] = 1
    return State(position.board, tuple(origins), position.player,
                 forward=tuple(history),
                 used_corners=tuple(a for a in history if a in CORNERS))


def symmetry_sample(sample, rotation, reflected):
    """Apply one square-board symmetry to every spatial state field and policy."""
    def square(index):
        x, y = index % 6, index // 6
        if reflected:
            x = 5 - x
        for _ in range(rotation):
            x, y = 5 - y, x
        return y * 6 + x

    mapping = tuple(square(i) for i in range(36))

    def board(values):
        result = [0] * 36
        for old, new in enumerate(mapping):
            result[new] = values[old]
        return tuple(result)

    def history(turns):
        return tuple(None if index is None else mapping[index] for index in turns)

    old = sample.state
    state = State(board(old.board), board(old.origins), old.player, old.direction,
                  history(old.forward), history(old.reverse),
                  tuple(sorted(mapping[index] for index in old.used_corners)), old.ended)
    policy = np.zeros(37, dtype=np.float32)
    for old_index, new_index in enumerate(mapping):
        policy[new_index] = sample.policy[old_index]
    policy[PASS] = sample.policy[PASS]
    return Sample(state, policy, sample.value)


def candidate_states(rng, ordinary_games, variant_games, max_turns=512):
    initial = create_game()
    for _ in range(ordinary_games):
        position = Position(initial.board, initial.player)
        history = []
        for _ in range(max_turns):
            if terminal(position):
                break
            yield ordinary_state(position, history), position, 'ordinary'
            action = int(rng.choice(legal(position)))
            position = play(position, action)
            history.append(None if action == PASS else action)
        else:
            raise RuntimeError('Ordinary Othello game exceeded max_turns')
    for _ in range(variant_games):
        state = create_game()
        for _ in range(max_turns):
            if state.ended:
                break
            position = Position(state.board, state.player)
            if not terminal(position):
                yield state, position, 'time_inversi'
            state = step(state, int(rng.choice(legal_actions(state))))
        else:
            raise RuntimeError('TIME REVERSI game exceeded max_turns')


def build_samples(teacher, rng, ordinary_games, variant_games, sample_count,
                  ordinary_share=0.5):
    if not 0 <= ordinary_share <= 1:
        raise ValueError('ordinary_share must be between 0 and 1')
    candidates = list(candidate_states(rng, ordinary_games, variant_games))
    if not candidates:
        raise ValueError('No teacher positions were generated')
    # The source mix is configurable; retain variant positions so the network
    # can learn the inversion and history inputs when ordinary_share is high.
    groups = {name: [] for name in ('ordinary', 'time_inversi')}
    for state, position, name in candidates:
        groups[name].append((state, position))
    selected = []
    ordinary_count = round(sample_count * ordinary_share)
    for name, amount in (('ordinary', ordinary_count),
                         ('time_inversi', sample_count - ordinary_count)):
        if amount and not groups[name]:
            raise ValueError(f'No {name} candidates')
        late = [i for i, (_, position) in enumerate(groups[name])
                if position.board.count(0) <= teacher.exact_empty]
        late_count = min(len(late), amount // 2)
        chosen = list(rng.choice(late, late_count, replace=False)) if late_count else []
        chosen_set = set(chosen)
        remainder = [i for i in range(len(groups[name])) if i not in chosen_set]
        needed = amount - late_count
        chosen.extend(rng.choice(remainder or range(len(groups[name])), needed,
                                 replace=needed > len(remainder or groups[name])))
        indices = chosen
        selected.extend((groups[name][int(i)][0], groups[name][int(i)][1], name)
                        for i in np.atleast_1d(indices))
    rng.shuffle(selected)
    samples = []
    counts = {'ordinary': {'opening_book': 0, 'exact': 0, 'approximate': 0},
              'time_inversi': {'opening_book': 0, 'exact': 0, 'approximate': 0}}
    for number, (state, position, name) in enumerate(selected, 1):
        policy, value, source = teacher.label_with_source(position, state)
        allowed = set(legal_actions(state))
        if any(policy[a] > 0 for a in range(37) if a not in allowed):
            raise AssertionError('Ordinary and TIME REVERSI legality disagree')
        samples.append(Sample(state, policy, value))
        counts[name][source] += 1
        if sample_count >= 100 and number % max(1, sample_count // 10) == 0:
            print(f'Teacher labels {number}/{sample_count}', flush=True)
    return samples, counts


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--teacher', required=True, type=Path,
                   help='Local oracle weight.rs or alpha-zero-general 6x6 PyTorch checkpoint')
    p.add_argument('--teacher-type', choices=('auto', 'oracle', 'neural'), default='auto')
    p.add_argument('--init-model', type=Path,
                   help='Continue distillation from an Oracle pretrained checkpoint')
    p.add_argument('--opening-tree', type=Path,
                   help='Oracle opening tree (default: next to Oracle coefficient file)')
    p.add_argument('--opening-data', type=Path,
                   help='Oracle opening node data (default: next to Oracle coefficient file)')
    p.add_argument('--output', required=True, type=Path)
    p.add_argument('--ordinary-games', type=int, default=12)
    p.add_argument('--variant-games', type=int, default=12)
    p.add_argument('--samples', type=int, default=300)
    p.add_argument('--ordinary-share', type=float, default=0.5,
                   help='Fraction of teacher samples from reachable ordinary Othello games')
    p.add_argument('--updates', type=int, default=500)
    p.add_argument('--batch-size', type=int, default=64)
    p.add_argument('--channels', type=int, default=64)
    p.add_argument('--blocks', type=int, default=3)
    p.add_argument('--history-hidden', type=int, default=64)
    p.add_argument('--learning-rate', type=float, default=.001)
    p.add_argument('--exact-empty', type=int, default=10)
    p.add_argument('--exact-nodes', type=int, default=300_000)
    p.add_argument('--exact-seconds', type=float, default=5.0)
    p.add_argument('--approximate-depth', type=int, default=3)
    p.add_argument('--approximate-seconds', type=float, default=2.0)
    p.add_argument('--seed', type=int, default=1234)
    p.add_argument('--threads', type=int, default=2)
    p.add_argument('--device', choices=('cpu', 'cuda', 'auto'), default='auto')
    p.add_argument('--augment-symmetries', action='store_true',
                   help='Train on all eight rotations/reflections of each labeled position')
    return p


def main(argv=None):
    from .checkpoint import device_for
    p = parser()
    args = p.parse_args(argv)
    initial_weights = None
    if args.init_model:
        initial_weights = torch.load(args.init_model, map_location='cpu', weights_only=True)
        if (initial_weights.get('format') != FORMAT or
                initial_weights.get('teacher_type') != 'oracle'):
            p.error('--init-model requires an Oracle distillation checkpoint')
        p.set_defaults(**initial_weights['network_config'])
        args = p.parse_args(argv)
        for name, expected in initial_weights['network_config'].items():
            if getattr(args, name) != expected:
                p.error(f'{name} must match --init-model ({expected})')
    for name in ('ordinary_games', 'variant_games', 'samples', 'updates', 'batch_size',
                 'exact_nodes', 'threads'):
        if getattr(args, name) < 1:
            raise ValueError(f'{name} must be positive')
    if (args.approximate_depth < 1 or args.approximate_seconds <= 0 or
            args.exact_seconds <= 0 or args.exact_empty < 0 or
            not 0 <= args.ordinary_share <= 1):
        raise ValueError('Invalid search settings')
    if args.output.exists():
        raise FileExistsError(f'Refusing to overwrite {args.output}')
    torch.set_num_threads(args.threads)
    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    device = device_for(args.device)
    teacher_path = args.teacher.resolve()
    teacher_type = ('oracle' if teacher_path.suffix == '.rs' else 'neural') if args.teacher_type == 'auto' else args.teacher_type
    if initial_weights is not None and teacher_type != 'oracle':
        p.error('--init-model requires an Oracle teacher')
    settings = dict(exact_empty=args.exact_empty, max_nodes=args.exact_nodes,
                    exact_seconds=args.exact_seconds,
                    approximate_depth=args.approximate_depth,
                    approximate_seconds=args.approximate_seconds)
    opening_files = None
    if teacher_type == 'oracle':
        tree_path = (args.opening_tree or teacher_path.parent / 'oracle-opening-tree.dat').resolve()
        data_path = (args.opening_data or teacher_path.parent / 'oracle-opening-data.dat').resolve()
        if not tree_path.is_file() or not data_path.is_file():
            raise FileNotFoundError('Oracle opening tree and data are required for Oracle training')
        opening_files = (tree_path, data_path)
        teacher = OracleTeacher(OracleEvaluator.from_file(teacher_path),
                                opening_book=OracleOpening(*opening_files), **settings)
    else:
        if args.opening_tree or args.opening_data:
            raise ValueError('Oracle opening data requires --teacher-type oracle')
        teacher = Teacher(load_pretrained(teacher_path, device), **settings)
    samples, label_counts = build_samples(teacher, rng, args.ordinary_games,
                                           args.variant_games, args.samples,
                                           args.ordinary_share)
    training_samples = ([symmetry_sample(sample, rotation, reflected)
                         for sample in samples for reflected in (False, True)
                         for rotation in range(4)] if args.augment_symmetries else samples)
    model = PolicyValueNet(NetworkConfig(args.channels, args.blocks, args.history_hidden)).to(device)
    if initial_weights is not None:
        model.load_state_dict(initial_weights['model'], strict=True)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=.0001)
    losses = []
    for update in range(args.updates):
        batch = [training_samples[int(i)] for i in rng.integers(len(training_samples), size=args.batch_size)]
        metrics = train_batch(model, optimizer, batch)
        losses.append(metrics['loss'])
        if (update + 1) % max(1, args.updates // 10) == 0:
            print(f'Update {update+1}/{args.updates}: loss={float(np.mean(losses[-10:])):.4f}', flush=True)
    metadata = dict(format=FORMAT, network_config=model.config_dict(), model=model.state_dict(),
                    teacher_sha256=hashlib.sha256(teacher_path.read_bytes()).hexdigest(),
                    teacher_filename=teacher_path.name, teacher_type=teacher_type,
                    opening_sha256=({path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                                     for path in opening_files} if opening_files else None),
                    init_model_sha256=(hashlib.sha256(args.init_model.read_bytes()).hexdigest()
                                       if args.init_model else None),
                    label_counts=label_counts,
                    ordinary_share=args.ordinary_share,
                    updates=args.updates, samples=len(samples),
                    augmented_samples=len(training_samples), seed=args.seed,
                    final_loss=float(np.mean(losses[-10:])))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + '.tmp')
    torch.save(metadata, temporary)
    temporary.replace(args.output)
    print(json.dumps({k: v for k, v in metadata.items() if k not in ('model', 'network_config')},
                     indent=2), flush=True)


if __name__ == '__main__':
    main()
