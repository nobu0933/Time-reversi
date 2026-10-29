# PRO追加学習：102回目から172回目まで

この手順は、試行でMIDに10勝0敗だった**102回目の候補**から、本学習を70イテレーション追加する。103回目の重みは開始点にしない。自己対戦6局、固定MIDとの対局2局、固定PRO100との対局2局、各手64探索、重み更新100回/イテレーション、学習率0.0002を維持する。固定相手との対局は黒白1局ずつで、学習する着手は新PRO側だけ。評価は5イテレーションごとにMIDとPRO100へ各10局、黒白同数で行う。

必要なファイルは`runs/pro-finetune-pilot-20261023/iteration-102.pt`、同じフォルダーの`mid.pt`と`pro100.pt`。ブラウザ用の`pro-model.js`では再開できない。新しいPCでは[READMEの「専用環境を作る」](../README.md#2-専用環境を作る)に従って`python_ai/.venv`を作る。学習中に元の試行フォルダーは変更しない。

## 実行

PowerShellで`Time Inversi/python_ai`へ移動してから、まず必要ファイルを確認する。

```powershell
Test-Path runs/pro-finetune-pilot-20261023/iteration-102.pt
Test-Path runs/pro-finetune-pilot-20261023/mid.pt
Test-Path runs/pro-finetune-pilot-20261023/pro100.pt
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

最初の3行が`True`になったら、次を1回実行する。初回は102回目の状態と固定相手を`runs/pro-long-from-102`へ保存してから、103回目を始める。保存先が既にある場合は、整合性を確認して続きから進む。

```powershell
.\.venv\Scripts\python.exe -m time_inversi.long_finetune --source runs/pro-finetune-pilot-20261023/iteration-102.pt --output runs/pro-long-from-102 --target-iteration 172 --device cpu
```

各回の終了時に`runs/pro-long-from-102/latest.pt`へ重み・最適化状態・対局履歴・乱数状態を保存する。5回ごと（107、112、…、172回目）の評価は`metrics.jsonl`に記録し、その時点の`iteration-107.pt`などを残す。停止した場合は**同じコマンドを再実行**すれば、保存済みの回から172回目までの残りだけを実行する。172回目まで終わっていれば何も追加学習しない。途中の1回は最初からやり直す。評価中に停止した場合は、次回起動時にその評価を補完する。

別の実行先を使う場合は`--output`だけ変更する。すでに別の学習データがあるフォルダーは指定しない。新規開始は102回目の重み・最適化状態・対局履歴を引き継ぎ、乱数種のみ変えて独立した系列にする。固定MID/PRO100のファイルが変更されたら実行を止める。元の102回目の保存点も変更しない。

## 所要時間の根拠

このPCでの試行では、評価なしの103回目が229.6秒（約3.8分）。MIDとPRO100に各10局の評価を含む102回目が814.0秒（約13.6分）だった。評価の追加時間を`814.0−229.6=584.4秒`と見積もると、70回の学習と14回の評価は、`70×229.6 + 14×584.4 = 24,255秒`、約**6時間44分**。この実測は同じCPU・64探索・各回10対局・評価各10局の条件で得たもので、現行の実行設定と一致する。

対局の長さ、PCの負荷、ディスク速度によって変動するので、6～8時間を保証する設定ではない。最初の107回目までの実測を`metrics.jsonl`の`seconds`で確認し、大きく遅い場合は中断・再開して運用する。イテレーション数を変えるなら、**同じ出力先で`--target-iteration`の数字だけ**変更する。評価回数を減らして時間を合わせると強さの推移を見失うため、評価条件は固定する。

各保存点は約43 MBで、14の評価保存点と作業用の固定相手を含むため、おおむね1 GBの空き容量を確保する。出力は`runs/`内にあり、通常はGitへ含めない。ブラウザで使用中のPROモデルは、この処理では変更されない。

## 結果の確認

```powershell
Get-Content runs/pro-long-from-102/metrics.jsonl | Select-Object -Last 5
.\.venv\Scripts\python.exe -m time_inversi.compare_models --candidate runs/pro-long-from-102/iteration-172.pt --incumbent runs/pro-long-from-102/pro100.pt --games 40 --simulations 64 --seed 31001 --device cpu
.\.venv\Scripts\python.exe -m time_inversi.compare_models --candidate runs/pro-long-from-102/iteration-172.pt --incumbent runs/pro-long-from-102/mid.pt --games 40 --simulations 64 --seed 31002 --device cpu
```

MIDとの10局の成績だけでは強さを確定できない。107、112、…、172回目の候補を見比べ、別乱数種でPRO100・MIDの両方へ黒白同数で評価する。白番の成績やTime reversalが起きた対局も確認し、最良候補を選んでからブラウザへ書き出す。
