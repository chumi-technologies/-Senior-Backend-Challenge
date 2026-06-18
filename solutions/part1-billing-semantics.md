# Part 1 — Billing Semantics Incident

## 1. Business glossary

| Term | Meaning in this incident | Source of truth | Must not be confused with |
|---|---|---|---|
| customer balance | | | provider balance / load-balancing weight |
| provider balance | | | customer wallet |
| load balance | | | money |
| official cost / total cost | | | actual payable debit |
| actual cost / payable cost | | | official list price |
| raw usage event | | | ledger entry |
| ledger entry | | | dashboard aggregate |
| team prepaid multiplier | | | provider discount |

字段备注：customer balance 看 ledger；official cost 是 `$100.00`；actual payable debit 是 `$40.00`；prepaid multiplier 是客户的 `0.4`，不是 provider discount。

## 2. Incident classification

不是 wrong debit，先按 wrong label / ambiguous dashboard aggregate 处理。

## 3. Source-of-truth map

```text
raw usage -> official cost $100.00 -> prepaid 0.4 -> ledger debit $40.00 -> dashboard label
```

## 4. Required answers

- 客户余额：看 ledger entries。
- 官方用量：看 raw usage + official price。
- prepaid multiplier：影响 ledger debit，不改 raw usage。
- 历史 ledger：不重写。
- double billing：目前不像，`$100.00 * 0.4 = $40.00`。
- dashboard：要区分官方用量和实际扣款。

## 5. Fix plan

- 改：dashboard label / aggregate display。
- 不改：raw usage、ledger、provider balance、routing、load-balancing weight。
- 风险：`Total usage cost` 容易被客户理解成实际扣款。

## 6. Verification evidence

- official list-price usage 保持 `$100.00`。
- payable prepaid debit 保持 `$40.00`。
- provider balance 不碰。
- load-balancing weight 不碰。
- 同一 usage event 不重复扣款。
