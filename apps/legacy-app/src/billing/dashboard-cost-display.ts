export type DashboardCostDisplayInput = {
    readonly officialUsageCostCents: number;
    readonly prepaidMultiplier: number;
    readonly providerBalanceCents: number;
    readonly loadBalancingWeight: number;
};

export type DashboardCostDisplay = {
    readonly officialUsageCostCents: number;
    readonly payablePrepaidDebitCents: number;
    readonly customerPrimaryLabel: string;
    readonly customerPrimaryAmountCents: number;
    readonly officialUsageLabel: string;
    readonly providerBalanceCents: number;
    readonly loadBalancingWeight: number;
};

export function buildDashboardCostDisplay(input: DashboardCostDisplayInput): DashboardCostDisplay {
    const payablePrepaidDebitCents = Math.round(input.officialUsageCostCents * input.prepaidMultiplier);

    return {
        officialUsageCostCents: input.officialUsageCostCents,
        payablePrepaidDebitCents,
        customerPrimaryLabel: 'Prepaid wallet debit',
        customerPrimaryAmountCents: payablePrepaidDebitCents,
        officialUsageLabel: 'Official list-price usage',
        providerBalanceCents: input.providerBalanceCents,
        loadBalancingWeight: input.loadBalancingWeight,
    };
}
