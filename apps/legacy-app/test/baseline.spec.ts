import { AnalysisService } from "../src/analysis/analysis.service";

describe("legacy analysis baseline", () => {
  it("delegates reads to the persistence adapter", async () => {
    const expected = { jobId: "job-1", status: "PENDING" };
    const database = { findJobById: jest.fn().mockResolvedValue(expected) };
    const queue = { publishEvent: jest.fn() };
    const service = new AnalysisService(database as never, queue as never);

    await expect(service.getAnalysisById("job-1")).resolves.toBe(expected);
    expect(database.findJobById).toHaveBeenCalledWith("job-1");
  });
});
