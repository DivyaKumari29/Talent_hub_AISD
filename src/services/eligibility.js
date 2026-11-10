// FR-06: pure function, no database access. Evaluates ALL rules and returns every reason.
// Boundaries are inclusive: cgpa >= min_cgpa, active_backlogs <= max_backlogs.
function checkEligibility(student, job, allowedBranches) {
  const reasons = [];
  if (!job.is_open) reasons.push('Job is closed');
  if (student.cgpa < job.min_cgpa) reasons.push(`CGPA ${student.cgpa} is below the minimum ${job.min_cgpa}`);
  if (student.active_backlogs > job.max_backlogs)
    reasons.push(`Active backlogs ${student.active_backlogs} exceed the maximum ${job.max_backlogs}`);
  // No allowed-branch rows means every branch is eligible.
  if (allowedBranches.length > 0 && !allowedBranches.includes(student.branch))
    reasons.push(`Branch ${student.branch} is not allowed (allowed: ${allowedBranches.join(', ')})`);
  return { eligible: reasons.length === 0, reasons };
}
module.exports = { checkEligibility };
