# 新方式PRO：ダウンロードから学習・評価まで

この手順は、通常6×6オセロの教師による事前学習済み重みから、TIME REVERSIの自己対戦100イテレーションを新規に始めるためのものです。**学習用には`Time Inversi`フォルダー全体**をダウンロード・展開してください。`dist/time-inversi-web.zip`はWeb公開専用で、Pythonの学習コードと教師重みを含みません。`AlphaZero`などの別フォルダーやNode.jsは学習に不要です。

以下は64ビット版Pythonが使えるWindows PCのPowerShellを想定します。CPUだけで実行できます。確認済みの環境はWindows、Python 3.14、PyTorch 2.14.1（CPU）です。最初のライブラリ導入にはインターネット接続が必要です。

## 1. フォルダーと必要ファイルを確認する

ダウンロードしたZIPを展開し、**`Time Inversi`フォルダーの中**でPowerShellを開きます。次を実行してください。

```powershell
cd python_ai
python --version
Test-Path requirements.txt
Test-Path time_inversi/train.py
Test-Path pretrained/oracle-weight.rs
Test-Path pretrained/oracle-opening-tree.dat
Test-Path pretrained/oracle-opening-data.dat
Test-Path runs/oracle-opening-pretrain-v1.pt
Test-Path runs/experiment01/latest.pt
```

学習コード・Oracle係数表・2つの定跡データの`Test-Path`は`True`である必要があります。`runs/oracle-opening-pretrain-v1.pt`は完成済みの事前学習重みで、これも`True`なら手順3から始められます。`False`なら後述の「事前学習を作り直す」を先に実行します。`runs/experiment01/latest.pt`は比較相手のMIDです。Git用フォルダーには、これらと102回目の追加学習用フルチェックポイントを含めています。Web公開用ZIPには学習コードを含めません。

## 2. このPC専用のPython環境を作る

```powershell
python -m venv .venv-pro
.\.venv-pro\Scripts\python.exe -m pip install --upgrade pip
.\.venv-pro\Scripts\python.exe -m pip install -r requirements.txt
.\.venv-pro\Scripts\python.exe -m pip check
.\.venv-pro\Scripts\python.exe -c "import torch, numpy; print('PyTorch', torch.__version__, 'NumPy', numpy.__version__, 'CUDA', torch.cuda.is_available())"
```

他のPCからコピーされた`.venv`がフォルダーにあっても使わず、新しい`.venv-pro`を使います。仮想環境の有効化は不要です。`CUDA False`はCPUで正常に動く状態です。`python`が見つからない場合は、PythonをPATHへ追加したうえでPowerShellを開き直してください。

動作確認をする場合は次を実行します。Node.jsがないPCではJavaScriptとの照合だけがスキップされます。

```powershell
.\.venv-pro\Scripts\python.exe -m unittest discover -s tests -v
```

## 3. 新PROの自己対戦学習を始める

`runs/oracle-opening-pretrain-v1.pt`がある場合、教師からの事前学習は**再実行不要**です。通常オセロ由来とTIME REVERSI由来の局面を半々にし、Oracleの定跡・評価関数と通常オセロの終盤厳密解を教師にしています。通常局面8割の重みも試しましたが、独立した終盤局面では改善しなかったため、現時点ではこの重みを推奨します。自己対戦はTIME REVERSIのルールと実際の勝敗を使用します。

最初に短い実行確認をする場合は、空の保存先を指定して次を実行します。`metrics.jsonl`に`reverse_turns`や`corner_inversions`が記録され、`latest.pt`が作られれば、自己対戦から重み更新まで動いています。

```powershell
.\.venv-pro\Scripts\python.exe -m time_inversi.train --init-model runs/oracle-opening-pretrain-v1.pt --iterations 1 --self-play-games 2 --simulations 4 --batch-size 16 --updates 2 --eval-every 0 --device cpu --output runs/pro-check
```

本学習は別の保存先で次を実行します。

```powershell
.\.venv-pro\Scripts\python.exe -m time_inversi.train --init-model runs/oracle-opening-pretrain-v1.pt --iterations 100 --self-play-games 10 --simulations 64 --device cpu --output runs/pro01
```

`runs/pro01`は新しい保存先です。既に使用済みなら`runs/pro02`など別名に変更してください。100イテレーションで、各回にTIME REVERSIのルールによる自己対戦10局、各手64探索、100回の重み更新を行い、5イテレーションごとにランダムAI・greedy AIとの評価も行います。各イテレーション終了時に`runs/pro01/latest.pt`を保存し、`runs/pro01/metrics.jsonl`に損失・対局長・逆行中の手番数`reverse_turns`・パス回数`passes`・角によるTime reversal回数`corner_inversions`・評価結果を追記します。Oracle版の重みから本学習と同じ設定で1イテレーションを実測すると226.1秒、評価40局の推定は約6分29秒でした。100回へ外挿した中心値は**約8.4時間**で、変動を見込んだ予定枠は**8〜12時間**です。MIDとの追加比較は別にかかります。最初の5〜10イテレーションの所要時間を確認し、残り時間を見積もってください。

Ctrl+Cで停止した場合、完了済みの最後のイテレーションから再開できます。`--iterations`は**追加する回数**です。例えば50回完了後に残り50回を実行する場合：

```powershell
.\.venv-pro\Scripts\python.exe -m time_inversi.train --resume runs/pro01/latest.pt --iterations 50 --device cpu
```

実行中のイテレーションは保存されていません。別PCへ移す場合は`runs/pro01`を含むフォルダーをコピーし、そのPCでPython環境を作り直してから`--resume`します。

## 4. 学習済み新PROを評価する

100回完了後、まず黒白を入れ替えながらランダムAIとgreedy AIに対戦させます。

```powershell
.\.venv-pro\Scripts\python.exe -m time_inversi.evaluate --checkpoint runs/pro01/latest.pt --opponent random --games 20 --simulations 64 --device cpu
.\.venv-pro\Scripts\python.exe -m time_inversi.evaluate --checkpoint runs/pro01/latest.pt --opponent greedy --games 20 --simulations 64 --device cpu
```

MIDの`runs/experiment01/latest.pt`もある場合、最後に両モデルを黒白同数で直接対局させます。

```powershell
.\.venv-pro\Scripts\python.exe -m time_inversi.compare_models --candidate runs/pro01/latest.pt --incumbent runs/experiment01/latest.pt --games 20 --simulations 64 --device cpu
```

結果の`wins`、`draws`、`losses`、`by_color`を確認してください。20局は初期比較であり、棋力差を確定するには局数と乱数種を増やす必要があります。学習後のモデルをWeb画面へ反映するには、次の書き出しを実行します。MIDの重みは変更しません。

100回学習済みのPROをMIDと100回時点のPROとの対局も交えて追加学習する場合は、[最終調整の手順](docs/PRO_FINETUNING.md)を参照してください。

147回目を起点にMID・PRO100・122回目を相手とし、異なる序盤も混ぜて追加学習する場合は、[混合相手による追加学習手順](docs/PRO_MIXED_FINETUNING_FROM_147.md)を参照してください。

202回目を起点にMID・PRO100・122回目・207回目と各回24局対戦させる場合は、[202回目からの追加学習手順](docs/PRO_FINETUNING_FROM_202.md)を参照してください。

```powershell
.\.venv-pro\Scripts\python.exe -m time_inversi.export_browser --checkpoint runs/pro-mixed-from-202/iteration-307.pt --output ../assets/ai/pro-model.js
```

## 事前学習を作り直す場合のみ

`runs/oracle-opening-pretrain-v1.pt`がない場合、同梱のOracle係数表と序盤定跡から新しい出力名で作れます。この評価関数は通常オセロ用で、TIME REVERSIのTime reversalまで解いたものではありません。その後に上記の自己対戦学習が必要です。

```powershell
.\.venv-pro\Scripts\python.exe -m time_inversi.pretrain --teacher pretrained/oracle-weight.rs --output runs/oracle-pretrain-new.pt --ordinary-games 80 --variant-games 80 --ordinary-share 0.5 --samples 2000 --updates 3000 --augment-symmetries --teacher-type oracle --exact-empty 10 --device cpu
```

その場合、手順3の`--init-model runs/oracle-opening-pretrain-v1.pt`を`--init-model runs/oracle-pretrain-new.pt`に置き換えてください。同梱のOracle係数表のSHA-256は`6fe8fb524772986986a0c9ddd8275664ecf4cc81a8915ea7b9bb00bb703f3f6a`です。事前学習のチェックポイントは全更新終了時に作成され、中断再開には対応していません。係数表の出典は[ORACLE_SOURCE.md](pretrained/ORACLE_SOURCE.md)に記載しています。

通常オセロ由来を8割に増やす実験もできます。`--ordinary-share 0.8`で教師局面の割合を指定し、`--init-model`で既存のOracle重みから追学習します。これは比較用で、現時点の推奨重みは変更しません。

```powershell
.\.venv-pro\Scripts\python.exe -m time_inversi.pretrain --teacher pretrained/oracle-weight.rs --teacher-type oracle --init-model runs/oracle-opening-pretrain-v1.pt --output runs/oracle-ordinary-focus-new.pt --ordinary-games 40 --variant-games 20 --ordinary-share 0.8 --samples 1000 --updates 800 --learning-rate 0.0002 --augment-symmetries --exact-empty 10 --seed 4321 --device cpu
```

macOS/Linuxでは環境作成を`python3 -m venv .venv-pro`に、実行ファイルを`./.venv-pro/bin/python`に置き換えます。これらのOSでの動作はまだ検証していません。より詳しい設定と検証結果は[Python AI README](README.md)と[検証記録](VALIDATION.md)を参照してください。
