const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function groupProductionPlans(plans, now = new Date()) {
  const todayStart = Math.floor((now.getTime() + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  const upcomingPlans = [], overduePlans = [], undatedPlans = [];
  for (const plan of plans) {
    const requiredAt = plan.requiredDate ? new Date(plan.requiredDate).getTime() : NaN;
    if (!Number.isFinite(requiredAt)) undatedPlans.push(plan);
    else if (requiredAt < todayStart) overduePlans.push(plan);
    else upcomingPlans.push(plan);
  }
  const byDate = (a, b) => new Date(a.requiredDate).getTime() - new Date(b.requiredDate).getTime();
  upcomingPlans.sort(byDate);
  overduePlans.sort(byDate);
  return { upcomingPlans, overduePlans, undatedPlans };
}

module.exports = { groupProductionPlans };
