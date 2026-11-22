# 宿主机检测脚本（check.py）

线上跑的是宿主机 `/opt/upstream-check/check.py`（cron 每分钟看 `upstream/request` 触发，每天 02:00 定期）。
仓库里的 `sync/check.py` 是**同一份的版本化副本**，改逻辑请改这里再部署，避免线上脚本漂移。

部署：
```bash
cp sync/check.py /opt/upstream-check/check.py
python3 -c "import py_compile;py_compile.compile('/opt/upstream-check/check.py',doraise=True)"
python3 /opt/upstream-check/check.py
```
基线：`sync/upstream-state.json` 优先，`/opt/upstream-check/base*.txt` 只做兜底。
面板数字：`summary` / `sync.patch` 优先读 `sync/reports/last-result.json`（v2 拆分器的文件级结果，auto/manual/skip），
读不到或上游版本已变时才退回提交级启发式。
