import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDashboardCostDisplay } from '../src/billing/dashboard-cost-display';

describe('billing display semantics', () => {
  it('separates official list-price usage from prepaid wallet debit', () => {
    const display = buildDashboardCostDisplay({
      officialUsageCostCents: 10000,
      prepaidMultiplier: 0.4,
      providerBalanceCents: 250000,
      loadBalancingWeight: 25,
    });

    assert.equal(display.officialUsageCostCents, 10000);
    assert.equal(display.payablePrepaidDebitCents, 4000);
    assert.equal(display.customerPrimaryLabel, 'Prepaid wallet debit');
    assert.equal(display.customerPrimaryAmountCents, 4000);
    assert.equal(display.officialUsageLabel, 'Official list-price usage');
  });

  it('does not use prepaid multiplier to change provider balance or routing weight', () => {
    const display = buildDashboardCostDisplay({
      officialUsageCostCents: 10000,
      prepaidMultiplier: 0.4,
      providerBalanceCents: 250000,
      loadBalancingWeight: 25,
    });

    assert.equal(display.providerBalanceCents, 250000);
    assert.equal(display.loadBalancingWeight, 25);
  });
});
