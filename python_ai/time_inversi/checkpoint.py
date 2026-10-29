from pathlib import Path
import torch
from .network import NetworkConfig, PolicyValueNet

FORMAT = 'time-inversi-corners-v1'


def device_for(requested):
    if requested == 'auto':
        return torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    if requested == 'cuda' and not torch.cuda.is_available():
        raise RuntimeError('CUDA is unavailable; use --device cpu or install a CUDA-enabled PyTorch build')
    return torch.device(requested)


def save(path, model, optimizer, replay, rng, iteration, config):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = dict(format=FORMAT, network_config=model.config_dict(), model=model.state_dict(),
                   optimizer=optimizer.state_dict(), replay=replay.to_dict(),
                   numpy_rng=rng.bit_generator.state, torch_rng=torch.get_rng_state(),
                   cuda_rng=torch.cuda.get_rng_state_all() if torch.cuda.is_available() else [],
                   iteration=iteration, training_config=config, torch_version=str(torch.__version__))
    temporary = path.with_suffix(path.suffix + '.tmp')
    torch.save(payload, temporary)
    temporary.replace(path)


def load(path, device='cpu'):
    # Save/load use the same path and schema; clocks remain metadata only.
    data = torch.load(path, map_location='cpu', weights_only=True)
    if data.get('format') != FORMAT:
        raise ValueError('Checkpoint is not for the current TIME REVERSI rules and encoding')
    model = PolicyValueNet(NetworkConfig(**data['network_config'])).to(device)
    model.load_state_dict(data['model'])
    model.eval()
    return model, data
