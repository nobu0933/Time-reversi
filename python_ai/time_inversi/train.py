"""AlphaZero-style self-play, replay-buffer learning, checkpoint/resume and evaluation."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import time
import numpy as np
import torch
from torch.nn import functional as F
from .buffer import ReplayBuffer
from .checkpoint import device_for, load, save
from .evaluate import evaluate
from .network import NetworkConfig, PolicyValueNet, batch_inputs
from .rules import PASS
from .selfplay import self_play


def train_batch(model, optimizer, samples):
    model.train()
    boards, histories, legal = batch_inputs([s.state for s in samples], next(model.parameters()).device)
    target_policy = torch.as_tensor(np.stack([s.policy for s in samples]), device=boards.device)
    target_value = torch.tensor([s.value for s in samples], dtype=torch.float32, device=boards.device)
    if not torch.isfinite(target_value).all() or (target_value.abs() > 1).any():
        raise ValueError('Value targets must be finite and within [-1, 1]')
    if not torch.allclose(target_policy.sum(dim=1), torch.ones(len(samples), device=boards.device), atol=1e-5):
        raise ValueError('Policy targets must sum to one')
    if (target_policy[~legal] != 0).any() or (target_policy < 0).any():
        raise ValueError('Policy target contains an illegal action')
    logits, value = model(boards, histories)
    policy_loss = -(target_policy * F.log_softmax(logits.masked_fill(~legal, -1e9), dim=1)).sum(dim=1).mean()
    value_loss = F.mse_loss(value, target_value)
    loss = policy_loss + value_loss
    if not torch.isfinite(loss):
        raise RuntimeError('Non-finite training loss')
    optimizer.zero_grad(set_to_none=True)
    loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
    optimizer.step()
    model.eval()
    return dict(loss=float(loss.detach()), policy_loss=float(policy_loss.detach()), value_loss=float(value_loss.detach()))


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--iterations', type=int, default=100, help='additional iterations when resuming')
    p.add_argument('--self-play-games', type=int, default=10)
    p.add_argument('--simulations', type=int, default=64)
    p.add_argument('--temperature-moves', type=int, default=12)
    p.add_argument('--max-moves', type=int, default=512)
    p.add_argument('--batch-size', type=int, default=64)
    p.add_argument('--updates', type=int, default=100)
    p.add_argument('--buffer-size', type=int, default=50000)
    p.add_argument('--learning-rate', type=float, default=0.001)
    p.add_argument('--weight-decay', type=float, default=0.0001)
    p.add_argument('--channels', type=int, default=64)
    p.add_argument('--blocks', type=int, default=3)
    p.add_argument('--history-hidden', type=int, default=64)
    p.add_argument('--eval-every', type=int, default=5, help='0 disables evaluation')
    p.add_argument('--eval-games', type=int, default=20)
    p.add_argument('--seed', type=int, default=1234)
    p.add_argument('--threads', type=int, default=2)
    p.add_argument('--device', choices=['auto', 'cpu', 'cuda'], default='auto')
    p.add_argument('--output', type=Path)
    p.add_argument('--resume', type=Path)
    p.add_argument('--init-model', type=Path,
                   help='Start a new TIME REVERSI run from ordinary-Othello distilled weights')
    return p


def main(argv=None):
    p = parser()
    args = p.parse_args(argv)
    if args.init_model and args.resume:
        p.error('--init-model starts a new run and cannot be combined with --resume')
    initial_weights = None
    if args.init_model:
        initial_weights = torch.load(args.init_model, map_location='cpu', weights_only=True)
        if initial_weights.get('format') != 'time-inversi-ordinary-pretrain-v1':
            p.error('--init-model requires a distilled ordinary-Othello checkpoint')
        p.set_defaults(**initial_weights['network_config'])
        args = p.parse_args(argv)
        for name, expected in initial_weights['network_config'].items():
            if getattr(args, name) != expected:
                p.error(f'{name} must match --init-model ({expected})')
    restored = None
    if args.resume:
        restored = load(args.resume, device_for(args.device))
        model, data = restored
        # Only training settings inherit; paths, device and additional iterations are local.
        saved = {k: v for k, v in data['training_config'].items()
                 if k in vars(args) and k not in ('resume', 'output', 'device', 'iterations', 'init_model')}
        saved.update(data['network_config'])
        saved['buffer_size'] = data['replay']['capacity']
        saved['learning_rate'] = data['optimizer']['param_groups'][0]['lr']
        saved['weight_decay'] = data['optimizer']['param_groups'][0]['weight_decay']
        p.set_defaults(**saved)
        args = p.parse_args(argv)
        for name in ('channels', 'blocks', 'history_hidden', 'buffer_size', 'learning_rate', 'weight_decay'):
            if getattr(args, name) != saved[name]:
                p.error(f'{name} cannot change on resume; saved value is {saved[name]}')
    for name in ['iterations', 'self_play_games', 'simulations', 'max_moves', 'batch_size', 'updates', 'buffer_size', 'threads']:
        if getattr(args, name) < 1:
            p.error(f'{name} must be positive')
    if args.batch_size > args.buffer_size or args.eval_every < 0 or args.temperature_moves < 0:
        p.error('Invalid batch/buffer size or interval')
    if args.eval_every and (args.eval_games < 2 or args.eval_games % 2):
        p.error('--eval-games must be even and at least 2')
    if not math.isfinite(args.learning_rate) or not math.isfinite(args.weight_decay) or args.learning_rate <= 0 or args.weight_decay < 0:
        p.error('Invalid optimizer settings')
    device = device_for(args.device)
    torch.set_num_threads(args.threads)
    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    output = (args.output or (args.resume.parent if args.resume else Path(__file__).resolve().parents[1] / 'runs' / 'default')).resolve()
    checkpoint = output / 'latest.pt'
    if checkpoint.exists() and (not args.resume or checkpoint.resolve() != args.resume.resolve()):
        p.error(f'{checkpoint} exists; use --resume or a different --output')
    start = 0
    if args.resume:
        model, data = restored
        optimizer = torch.optim.AdamW(model.parameters())
        optimizer.load_state_dict(data['optimizer'])
        replay = ReplayBuffer.from_dict(data['replay'])
        if args.batch_size > replay.samples.maxlen:
            p.error('Batch size exceeds restored buffer capacity')
        rng.bit_generator.state = data['numpy_rng']
        torch.set_rng_state(data['torch_rng'])
        if device.type == 'cuda' and len(data['cuda_rng']) == torch.cuda.device_count():
            torch.cuda.set_rng_state_all(data['cuda_rng'])
        start = data['iteration']
    else:
        model = PolicyValueNet(NetworkConfig(args.channels, args.blocks, args.history_hidden)).to(device)
        if initial_weights is not None:
            model.load_state_dict(initial_weights['model'], strict=True)
        optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=args.weight_decay)
        replay = ReplayBuffer(args.buffer_size)
    output.mkdir(parents=True, exist_ok=True)
    config = {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()}
    if initial_weights is not None:
        label_counts = initial_weights.get('label_counts') or {}
        ordinary_count = sum(label_counts.get('ordinary', {}).values())
        labeled_count = sum(sum(row.values()) for row in label_counts.values())
        config['pretraining'] = dict(
            checkpoint_name=args.init_model.name,
            checkpoint_sha256=hashlib.sha256(args.init_model.read_bytes()).hexdigest(),
            teacher_type=initial_weights.get('teacher_type'),
            teacher_sha256=initial_weights.get('teacher_sha256'),
            opening_sha256=initial_weights.get('opening_sha256'),
            init_model_sha256=initial_weights.get('init_model_sha256'),
            ordinary_share=initial_weights.get('ordinary_share',
                                               ordinary_count / labeled_count if labeled_count else None),
            label_counts=label_counts)
    elif args.resume and 'pretraining' in data['training_config']:
        config['pretraining'] = data['training_config']['pretraining']
    print(f'Device: {device}; output: {output}; starting iteration: {start}', flush=True)
    for iteration in range(start + 1, start + args.iterations + 1):
        began = time.perf_counter()
        turns = []
        reverse_turns = passes = corner_inversions = 0
        for game in range(args.self_play_games):
            samples, final_state = self_play(model, rng, args.simulations,
                                             args.temperature_moves, args.max_moves)
            replay.add(samples)
            turns.append(len(samples))
            reverse_turns += sum(sample.state.direction == -1 for sample in samples)
            passes += sum(bool(sample.policy[PASS] > 0.999) for sample in samples)
            corner_inversions += len(final_state.used_corners)
            print(f'Iteration {iteration}, game {game + 1}/{args.self_play_games}: {len(samples)} turns', flush=True)
        losses = []
        if len(replay) >= args.batch_size:
            for _ in range(args.updates):
                losses.append(train_batch(model, optimizer, replay.sample(args.batch_size, rng)))
        else:
            print(f'Waiting for samples: {len(replay)}/{args.batch_size}; no weight update this iteration', flush=True)
        metrics = dict(iteration=iteration, buffer=len(replay), games=len(turns),
                       mean_turns=float(np.mean(turns)), reverse_turns=reverse_turns,
                       passes=passes, corner_inversions=corner_inversions,
                       updates=len(losses))
        if losses:
            metrics.update({key: float(np.mean([loss[key] for loss in losses])) for key in losses[0]})
        save(checkpoint, model, optimizer, replay, rng, iteration, config)
        if args.eval_every and iteration % args.eval_every == 0:
            metrics['evaluation'] = {opponent: evaluate(model, args.eval_games, args.simulations, opponent,
                                                       args.seed + iteration * 1000, args.max_moves)
                                     for opponent in ('random', 'greedy')}
        metrics['seconds'] = time.perf_counter() - began
        with (output / 'metrics.jsonl').open('a', encoding='utf-8') as handle:
            handle.write(json.dumps(metrics) + '\n')
        print(json.dumps(metrics), flush=True)


if __name__ == '__main__':
    main()
