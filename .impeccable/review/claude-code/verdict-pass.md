## verdict

- Resolved — Initial Hook read failure: all three new captures (`first-read-failure-light-1180.png`, `first-read-failure-dark-960.png`, and `first-read-failure-dark-390.png`) are valid and visibly show “定义读取未完成，请使用「重新读取」重试。” with the add action disabled. The implementation now branches on a missing scan before successful-empty or search-result copy; the added regression asserts the failed-read message and absence of the false empty-inventory message.
- Regressions introduced by this fix: none observed in the supplied captures or changed branch.
- Scope: ship covers the scored fixes, not the whole surface.

## remaining

Clear.

disposition: ship
