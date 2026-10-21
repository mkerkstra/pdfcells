package pricing

// The Message Batches API bills every token at half the standard rate, cache
// reads and writes included, and that holds for Haiku's long-context tier too.
// Batch pages are charged at this cost plus the usual markup, so the discount
// reaches the person's credits.

// batchDivisor is 1e6 µ$/MTok × 2 for the 50% batch discount.
const batchDivisor = 2_000_000

// BatchCost returns the µ$ cost of u when served through the Batches API,
// each component rounded up on its own like Cost.
func BatchCost(u Usage) (int64, error) {
	r, err := RateFor(u.Model, u.Input+u.CacheRead+u.CacheWrite)
	if err != nil {
		return 0, err
	}
	half := func(tokens, rate int64) int64 { return ceilDiv(tokens*rate, batchDivisor) }
	return half(u.Input, r.Input) + half(u.Output, r.Output) + half(u.CacheRead, r.CacheRead) + half(u.CacheWrite, r.CacheWrite), nil
}
