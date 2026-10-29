# TIME REVERSI — Python / AlphaZero

TIME REVERSIのルールをPythonへ移植し、自己対戦・MCTS・方策／価値ネットワークによる学習を実装しています。必要な学習データが揃った`Time Inversi`フォルダーだけで環境構築・学習・評価できます。参考にした`AlphaZero`、`Penrosanne`、`P3NROSE`フォルダーは不要です。Git用フォルダーにもOracle元データ・推奨事前学習重み・102回目の追加学習用保存点を含めます。Oracle版PROの再学習前に[専用手順](PRO_TRAINING_GUIDE.md)を確認してください。

新方式PROだけを最初から順に実行する場合は、[ダウンロードから学習・評価までの手順](PRO_TRAINING_GUIDE.md)を参照してください。

100回学習済みPROをMID・100回時点のPROとの対局も含めて追加学習する場合は、[最終調整の手順](docs/PRO_FINETUNING.md)を参照してください。ブラウザ用`pro-model.js`からは学習を再開できず、フルチェックポイントが必要です。

102回目の有望な候補から70イテレーション継続する場合は、[102回目からの本学習手順](docs/PRO_LONG_TRAINING_FROM_102.md)を参照してください。実測に基づく所要時間と、中断後に同じコマンドで再開する方法を記載しています。

147回目の重みからMID・PRO100・122回目を固定相手に追加学習し、標準開始と異なる序盤の両方で評価する場合は、[混合相手による追加学習手順](docs/PRO_MIXED_FINETUNING_FROM_147.md)を参照してください。

202回目を起点にMID・PRO100・122回目・207回目との対局数を増やして約12時間追加学習する場合は、[202回目からの追加学習手順](docs/PRO_FINETUNING_FROM_202.md)を参照してください。

学習済みモデルはブラウザ用ファイルへ書き出せます。現在のゲームはブラウザ内でモデルとMCTSを動かすため、公開先にPythonサーバーは不要です。

## 1. ダウンロードしたフォルダーを開く（Windows）

以下はPythonがインストールされたWindows PCでのPowerShellの手順です。GPUは不要で、まずCPUで確認します。ライブラリの初回ダウンロードにはインターネット接続と空き容量が必要です。学習中のインターネット接続は不要です。

ダウンロードしたZIPを展開し、`Time Inversi`フォルダー内でターミナル（PowerShell）を開いてください。以降は、最初に次の2行を実行します。

```powershell
cd python_ai
python --version
```

`python_ai`フォルダー内に`requirements.txt`と`time_inversi`が見えることを確認してください。以降のコマンドはすべてこの場所から実行します。`python`が見つからない場合は、Pythonのインストール設定でPATHへの追加を有効にしてターミナルを開き直してください。

## 2. 専用環境を作る

他のPCの`.venv`はコピーして使いません。ダウンロード物に`.venv`が含まれている場合は、そのフォルダーを別名に退避してから新しく作ります。学習成果の`runs`はそのまま残してください。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe -c "import sys, torch, numpy; print(sys.version); print('PyTorch:', torch.__version__, 'NumPy:', numpy.__version__); print('CUDA:', torch.cuda.is_available())"
```

`Activate.ps1`は使わず、専用環境のPythonを直接指定するため、PowerShellの実行ポリシー変更は不要です。`CUDA: False`でもCPU学習は可能です。確認した環境は64bit Windows、Python 3.14、NumPy 2.5.4、PyTorch 2.14.1（CPU）です。すべてのPythonバージョン・OSでの動作を保証するものではありません。

同じWindows / Python 3.14環境で検証時の依存バージョンに揃えたい場合は、上の`requirements.txt`の代わりに`requirements-lock.windows-py314.txt`を指定できます。他のPythonやOSでは通常の`requirements.txt`を使用してください。GPU学習には使用するGPUに対応したPyTorch環境が別途必要です。`--device auto`はCUDAが利用可能ならCUDA、それ以外はCPUを選びます。`--device cuda`で利用できない場合はエラーになります。

macOS / Linuxでは、環境作成を`python3 -m venv .venv`とし、以降の`.\.venv\Scripts\python.exe`を`./.venv/bin/python`に置き換えます。これらのOSでの実行は未検証です。

## 3. 動作確認

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

ニューラルネットの重み更新、保存／再開の一致、黒白両方の評価AIなどを検証します。Node.jsは学習に不要です。Node.jsがないPCではJavaScript版との照合1件だけを`skipped`として省略します。Node.jsがある場合は実際の`../src/game/rules.js`と通常対局・パス・角反転・直接反転APIの遷移を照合します。検証記録は[VALIDATION.md](VALIDATION.md)を参照してください。

小規模な学習確認（初回専用の出力先を選んでください）：

```powershell
.\.venv\Scripts\python.exe -m time_inversi.train --iterations 1 --self-play-games 2 --simulations 4 --batch-size 8 --updates 2 --channels 16 --blocks 1 --history-hidden 16 --eval-every 1 --eval-games 2 --device cpu --output runs/check
```

`runs/smoke`は開発時の動作確認ログです。短時間の検証で使った重みは容量整理のため削除済みで、強さを保証する学習済みAIではありません。

成功すると`runs/check/latest.pt`と`runs/check/metrics.jsonl`が生成されます。表示された`updates`が2で、`loss`が数値になり、評価結果も出ていれば、自己対戦から学習・保存・評価まで完了しています。再実行時は別の出力名を選ぶか、次で続きから実行してください。

```powershell
.\.venv\Scripts\python.exe -m time_inversi.train --resume runs/check/latest.pt --iterations 1 --device cpu
```

## 4. 本学習を始める

```powershell
.\.venv\Scripts\python.exe -m time_inversi.train --iterations 100 --self-play-games 10 --simulations 64 --device cpu --output runs/experiment01
```

### Oracle評価関数から始める新方式PRO

[`mame/6x6-reversi-oracle`](https://github.com/mame/6x6-reversi-oracle)の中盤評価関数と序盤定跡をPythonへ取り込みました。定跡は通常オセロの初手から着手履歴が一致する間だけ使用し、Time reversal・角の発動・定跡からの逸脱後には適用しません。その後は、終盤で完全読みできれば厳密な**通常オセロ**の石差を優先し、読み切れなければOracle評価関数で近似します。評価関数は通常オセロでは到達できない盤面も受け付けます。Oracleのネイティブ探索器は使用していません。

従来の事前学習済み重み`runs/oracle-pretrain-v2.pt`は定跡追加前のOracle評価関数版です。定跡を含む新しい事前学習重みは`runs/oracle-opening-pretrain-v1.pt`です。通常オセロ1,000局面、TIME REVERSI由来1,000局面を教師にし、定跡89件・通常オセロの厳密解1,229件・Oracle近似評価682件でラベル化しました。8対称で16,000学習例、3,000更新しています。旧版は独立した終盤600局面で旧ニューラル教師版`ordinary-pretrain-v4.pt`の最善手一致363件に対し395件でした。新しい版の比較結果は[検証記録](VALIDATION.md)を参照してください。いずれもTIME REVERSIの真の最善手を測った数字ではありません。

教師局面の通常オセロ比率は`--ordinary-share`で変更できます。8割に増やした新規学習版と、上記の重みから8割で追学習した版も作って比較しましたが、通常オセロ終盤の最善手一致はそれぞれ182/300・198/300で、元の201/300を上回りませんでした。そのため、自己対戦の開始には`oracle-opening-pretrain-v1.pt`を推奨します。TIME REVERSIの自己対戦は角でのTime reversal・逆行・パスを含み、自己対戦の勝敗を教師にして重みを更新します。

以下は`python_ai`で実行します。現在公開中のMIDモデルを上書きしません。

```powershell
# Oracle教師だけの精度を通常局面・TIME REVERSI由来盤面で別集計する
.\.venv\Scripts\python.exe -m time_inversi.ordinary_benchmark --teacher pretrained/oracle-weight.rs --teacher-type oracle --ordinary-games 20 --variant-games 20 --max-empty 6 --approximate-depth 3

# 同梱済みの重みからTIME REVERSIの自己対戦を開始する
.\.venv\Scripts\python.exe -m time_inversi.train --init-model runs/oracle-opening-pretrain-v1.pt --iterations 100 --self-play-games 10 --simulations 64 --output runs/transfer01

# 旧MIDと黒白を交替して直接対局する
.\.venv\Scripts\python.exe -m time_inversi.compare_models --candidate runs/transfer01/latest.pt --incumbent runs/experiment01/latest.pt --games 20 --simulations 64
```

事前学習を作り直す場合は、上の自己対戦より先に次を実行し、`--init-model`を新しいファイル名へ変更してください。

```powershell
.\.venv\Scripts\python.exe -m time_inversi.pretrain --teacher pretrained/oracle-weight.rs --teacher-type oracle --output runs/oracle-pretrain-new.pt --ordinary-games 80 --variant-games 80 --samples 2000 --updates 3000 --augment-symmetries --exact-empty 10
```

短時間の動作確認には別の出力名で次を実行します。この設定は棋力評価用ではありません。

```powershell
.\.venv\Scripts\python.exe -m time_inversi.pretrain --teacher pretrained/oracle-weight.rs --teacher-type oracle --output runs/pro-check.pt --ordinary-games 1 --variant-games 1 --samples 8 --updates 2 --batch-size 4 --channels 8 --blocks 1 --history-hidden 8 --exact-empty 2 --device cpu
.\.venv\Scripts\python.exe -m time_inversi.train --init-model runs/pro-check.pt --iterations 1 --self-play-games 1 --simulations 2 --batch-size 8 --updates 1 --eval-every 0 --device cpu --output runs/pro-check-run
.\.venv\Scripts\python.exe -m time_inversi.evaluate --checkpoint runs/pro-check-run/latest.pt --opponent random --games 2 --simulations 2 --device cpu
```

途中で止めた自己対戦学習は`--resume runs/transfer01/latest.pt --iterations 100`で追加学習できます。`pretrain`は中断再開できず、重みは全更新終了時に保存します。Oracle版の重みから始める100イテレーションは、このPCでの1イテレーションと評価対局の実測を外挿すると約8.4時間です。変動を見込んで8〜12時間の予定枠を取り、最初の5〜10イテレーションから残り時間を見積もってください。MIDとの追加比較は含みません。

係数表の出典とハッシュは[ORACLE_SOURCE.md](pretrained/ORACLE_SOURCE.md)を参照してください。旧Alpha Zero General教師の重みは現行学習に不要なため、Git用フォルダーから除いています。Oracle版も通常ルールの結果を教えるだけで、TIME REVERSIの勝敗を保証しません。自己対戦後にMIDとの直接対局で棋力を確認してください。現在のブラウザ用PROには307回目の重みを`../assets/ai/pro-model.js`へ書き出しています。
1イテレーションは「自己対戦 → リプレイバッファに蓄積 → ミニバッチ学習 → 保存」です。5イテレーションごとにランダムAI・簡易貪欲AIと評価対局します。最初の12手はMCTSの訪問割合で着手を抽選し、それ以降は最多訪問手から選びます。自己対戦の探索だけにDirichletノイズを加えます。

主な設定：

| オプション | 初期値 | 内容 |
| --- | ---: | --- |
| `--self-play-games` | 10 | イテレーションあたりの対局数 |
| `--simulations` | 64 | 1手あたりのMCTS追加探索数 |
| `--batch-size` | 64 | 学習バッチサイズ |
| `--updates` | 100 | イテレーションあたりの更新回数 |
| `--buffer-size` | 50000 | 保持する局面数 |
| `--channels` | 64 | 畳み込みのチャンネル数 |
| `--blocks` | 3 | 残差ブロック数 |
| `--history-hidden` | 64 | 履歴GRUの隠れ状態サイズ |
| `--eval-every` | 5 | 評価間隔。0なら省略 |
| `--eval-games` | 20 | 相手1種類あたりの評価局数。偶数 |
| `--threads` | 2 | PyTorchのCPUスレッド数 |
| `--max-moves` | 512 | 異常な長期対局を検出する上限 |

自己対戦は現在1プロセスで逐次実行します。参考元のRay並列化は必須にしていません。学習サンプルがバッチサイズに満たない間は更新を待ちます。対局や探索が上限に達した場合はエラーとし、未終了の局面を引き分けとして学習しません。

所要時間はPCと対局長で変わります。最初の数イテレーションの`seconds`を目安にしてください。短い動作確認で棋力向上までは判定できません。現在は最新モデルで自己対戦を続ける構成で、過去の最良モデルとの昇格判定や対戦相手プールは未実装です。

### このPCで学習時間を測る

```powershell
.\.venv\Scripts\python.exe -m time_inversi.benchmark --init-model runs/oracle-opening-pretrain-v1.pt --games 3 --simulations 64 --updates 100 --batch-size 64 --device cpu --threads 2
```

指定したOracle版の重みで自己対戦3局（1手64探索）、バッチ64で100回の実更新、ランダムAI・簡易AIとの評価を各2局実行します。重みは読み込むだけで変更しません。CPU・2スレッドが既定です。`--init-model`を省略すると新規モデルを測ります。

処理別の実測秒数と、通常の1イテレーション／評価付き1イテレーション／100イテレーションの推定時間を表示し、`runs/benchmarks/`にJSONで保存します。推定は自己対戦10局・更新100回、5イテレーションごとに各相手20局評価という設定です。`--simulations`で探索数、`--games`で測定局数、`--device`で実行デバイスを変更できます。

短い測定からの概算で、保存・起動時間は含みません。学習に伴う対局長・履歴長の変化、バッファの蓄積、他のアプリの負荷で時間は変わります。「一定の強さになるまでの時間」を示すものではありません。

2026-10-21のOracle版の測定例（Intel Core i7-1165G7、CPU・2スレッド、Python 3.14.2、PyTorch 2.14.1+cpu、64探索）：

| 処理 | 所要時間 | 根拠 |
| --- | ---: | --- |
| 自己対戦1局 | 約17〜40秒（平均28.7秒） | Oracle版の3局を実測、48〜97手 |
| バッチ64で100回更新 | 約10.4秒 | 実測 |
| 通常の1イテレーション | 約3分46秒 | Oracle版で自己対戦10局＋100回更新＋保存を実行 |
| 評価40局 | 約6分29秒 | ランダム・greedy各2局の実測を20局ずつに換算 |
| 100イテレーション | 約8.4時間 | 通常100回＋5回ごとの評価40局を20回 |
| 100イテレーション・評価なし | 約6.3時間 | `--eval-every 0`の場合 |

測定ログ：`runs/benchmarks/20261021-081753-669351.json`と`runs/oracle-timing-first-iteration/metrics.jsonl`。3局の短いベンチマークだけなら評価込みで約10.4時間と出ますが、上表は実際の10局・1イテレーションの226.1秒を優先しています。対局長、履歴長、保存サイズの変化で100回の所要時間は変わります。

## 5. 停止・保存・再開

保存先は常に指定出力フォルダーの`latest.pt`です。重み、ネットワーク構成、最適化状態、バッファ、乱数状態、完了イテレーションを保存します。既存の重みがあるフォルダーへの新規学習は拒否し、誤上書きを防ぎます。`metrics.jsonl`には損失・対局長・評価成績を追記します。

```powershell
.\.venv\Scripts\python.exe -m time_inversi.train --resume runs/experiment01/latest.pt --iterations 100
```

`--iterations`は再開後に追加する回数（省略時100）です。対局数・探索数・バッチサイズ・評価間隔・乱数シードなどは保存済み設定を引き継ぎ、明示したオプションだけ変更します。モデル構成、学習率、重み減衰、バッファ容量は保存内容を復元し、異なる値の指定をエラーにします。`--device`は引き継がず、省略時`auto`です。CPUで続けるなら`--device cpu`を追加してください。同一環境のCPUでは連続実行との一致を検証済みですが、異なるデバイス・ライブラリ間の完全一致は保証しません。

停止はターミナルでCtrl+Cを押します。保存はイテレーションごとのため、処理中のイテレーションは失われ、直前の保存から再開します。最初の保存前に停止した場合は新規学習から開始してください。評価は保存の後に実施するため、評価中の停止ではモデルが保存されていても、その回の`metrics.jsonl`が未記録の場合があります。

別PCへ移すときは`Time Inversi`と必要な`runs`をコピーし、専用環境を作り直してから再開します。チェックポイントはモデルだけでなく学習データも含むため容量が増えます。同じ出力先で学習を同時に複数実行しないでください。履歴を残したいチェックポイントは学習停止中に別名で保管できます。

## 導入時のトラブル

| 表示・症状 | 対処 |
| --- | --- |
| `No module named torch` / `numpy` | `.venv`のPythonでインストールと実行の両方を行っているか確認します。 |
| `No module named time_inversi` | `Time Inversi/python_ai`へ移動してから実行します。 |
| `No matching distribution found` | Pythonのバージョン・64bit/32bit・OSと配布ライブラリの対応を確認します。検証済み環境は上記の通りです。 |
| ダウンロード失敗 | 接続・プロキシ設定を確認し、同じインストールコマンドを再実行します。 |
| `latest.pt exists` | 続けるなら`--resume`、新規なら別の`--output`を使用します。 |
| CUDA関連のエラー | まず`--device cpu`で動作確認します。 |
| メモリ不足・学習が遅い | 新規学習でバッファ容量・モデル幅・探索数・バッチサイズを小さくします。再開時はモデル幅やバッファ容量を変更できません。 |
| `exceeded max_moves` | 対局を引き分けとして扱わず停止します。必要に応じて`--max-moves`を増やして再開します。 |

## ブラウザで学習済みAIと対局

MIDとPROはブラウザだけで動きます。MIDの100回目は`../assets/ai/model.js`、PROの307回目は`../assets/ai/pro-model.js`に書き出し済みです。CPUボタンは`OFF → EZY → MID → PRO`の順です。EZYはランダムです。GitHub Pagesやitch.ioに公開するファイルと手順は[静的サイトへの公開](../docs/STATIC_HOSTING.md)を参照してください。

追加学習した重みに差し替える場合、`python_ai`から実行します。

```powershell
.\.venv\Scripts\python.exe -m time_inversi.export_browser --checkpoint runs/experiment01/latest.pt
.\.venv\Scripts\python.exe -m time_inversi.export_browser --checkpoint runs/pro-mixed-from-202/iteration-307.pt --output ../assets/ai/pro-model.js
```

書き出し後は親フォルダーで`python scripts/package_web.py`を実行し、公開ZIPを作り直します。閲覧者にPythonやPyTorchのインストールは不要です。

従来の`serve.py`の着手APIはPython版の比較用として残しています。通常のゲーム画面はそのAPIを呼ばず、同梱のブラウザ用モデルを読み込みます。`serve --checkpoint`でAPIのモデルを変えても画面側のモデルは変わらないため、画面側の更新には必ず上記の書き出しを行ってください。

## 評価と着手選択

```powershell
.\.venv\Scripts\python.exe -m time_inversi.evaluate --checkpoint runs/experiment01/latest.pt --opponent greedy --games 20 --simulations 64
.\.venv\Scripts\python.exe -m time_inversi.evaluate --checkpoint runs/experiment01/latest.pt --opponent random --games 20 --simulations 64
.\.venv\Scripts\python.exe -m time_inversi.predict --checkpoint runs/experiment01/latest.pt --state state.json
```

評価は黒番・白番を半数ずつ行い、勝ち・負け・引き分けを色別にも集計します。着手選択はブラウザの状態オブジェクトと同形式のJSONを読み込み、`action`（0～35、パスは36）、`index`（パスはnull）、訪問割合を返します。空の初期局面JSONの作成例：

```powershell
.\.venv\Scripts\python.exe -c "import json; from pathlib import Path; from time_inversi.rules import create_game; Path('state.json').write_text(json.dumps(create_game().to_dict()), encoding='utf-8')"
```

## TIME REVERSIへの対応

- 6×6盤、黒先手、初期配置はブラウザと同じ。
- 通常の挟み込み、配置後の逆方向履歴の消化、パス、初回の角配置によるTime reversalを再現。
- パス履歴は消去しない空の1手として保持。駒の消滅でも過去の裏返しは戻しません。
- 消滅と角反転の処理後に終局を判定。最初の時刻へ戻っても自動反転しません。
- 選択可能な行動は36マス＋パスの37通り。手動Time reversalは現在のUIにないため行動に含めません。`invert()`はJavaScriptとの照合用の内部APIです。
- MCTSの局面識別には駒の色、配置方向、手番、時間方向、両方向の全履歴、使用済みの角を使用。時計は演出なので探索・学習入力から除外します。

ネットワークは8枚の盤面入力（自分／相手、順行／逆行駒、使用済み角、合法マス、時間方向、手番色）を残差CNNで処理し、順行・逆行の全履歴をGRUで処理します。パス・空履歴・パディングは別のトークンです。履歴の順序や長さを固定長で切り捨てません。方策37出力と、手番側から見た勝敗価値1出力を学習します。

## 参考コードからの修正点

- 簡易AIは白枚数への固定参照をやめ、常に着手する側の「自分の枚数 − 相手の枚数」を最大化。候補が全て不利でも合法手を返します。
- 評価対象は配置・消滅・角反転が完了した状態。確定した勝敗を優先します。
- 評価は黒白を同数とし、探索ノイズを無効化します。
- 保存と読み込みのパスを統一し、最適化状態・学習バッファも再開可能にしました。
- AdamWで重み減衰を適用し、損失の非有限値・不正な方策ターゲットを検出します。

## 構成

```text
python_ai/
  time_inversi/
    rules.py       # Pythonルール・JSON状態・遷移
    encoding.py    # 盤面と全履歴の入力
    network.py     # 残差CNN＋GRU、方策／価値ネット
    mcts.py        # PUCT探索
    selfplay.py    # 自己対戦・勝敗ラベル
    buffer.py      # 学習用リプレイバッファ
    baselines.py   # ランダムAI・色を正しく評価する簡易AI
    checkpoint.py  # 保存・復元・デバイス選択
    train.py       # 学習コマンド
    evaluate.py    # 両色での評価
    predict.py     # 局面JSONからの着手選択
    export_browser.py # 静的サイト用モデルの書き出し
    serve.py       # Python推論比較用APIとローカル配信
  tests/           # JS照合、探索・学習・復元テスト
  runs/            # 重みとログ（生成物）
  requirements.txt
```
