//! Explicit deny-by-default memory access policy for future physical adapters.
//!
//! This is a policy boundary, not a hardware session factory. The current HTTP
//! server only constructs a simulator. Any future hardware session/write path
//! must enforce this gate after independently verifying the ECU identity.

/// An identity is "verified" only after an adapter-specific trusted check.
/// A browser-supplied string or ELF address must not establish this status.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    Simulator,
    PhysicalUnverified,
    PhysicalVerified,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Operation {
    ReadMemory,
    WriteMemory,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Denied {
    TargetUnverified,
    WritesDisabled,
}

/// There is intentionally no configuration field or API to enable writing.
/// Introducing one requires a separately reviewed calibration transaction,
/// physical safe-state verification, operator confirmation and hardware tests.
#[derive(Default)]
pub struct HardwareAccessPolicy;

impl HardwareAccessPolicy {
    pub fn authorize(&self, target: Target, operation: Operation) -> Result<(), Denied> {
        if operation == Operation::WriteMemory {
            return Err(Denied::WritesDisabled);
        }
        match target {
            Target::Simulator | Target::PhysicalVerified => Ok(()),
            Target::PhysicalUnverified => Err(Denied::TargetUnverified),
        }
    }
}

/// Fail startup if the compiled policy ever permits implicit memory writes.
/// Does not imply that a physical adapter has been activated or validated.
pub fn verify_startup_policy() -> Result<(), &'static str> {
    let policy = HardwareAccessPolicy;
    if policy
        .authorize(Target::Simulator, Operation::ReadMemory)
        .is_err()
        || policy
            .authorize(Target::PhysicalVerified, Operation::ReadMemory)
            .is_err()
        || policy
            .authorize(Target::PhysicalUnverified, Operation::ReadMemory)
            .is_ok()
        || policy
            .authorize(Target::Simulator, Operation::WriteMemory)
            .is_ok()
        || policy
            .authorize(Target::PhysicalVerified, Operation::WriteMemory)
            .is_ok()
        || policy
            .authorize(Target::PhysicalUnverified, Operation::WriteMemory)
            .is_ok()
    {
        return Err("hardware access policy failed closed");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simulated_and_physical_memory_writes_are_prohibited() {
        let policy = HardwareAccessPolicy;
        for target in [
            Target::Simulator,
            Target::PhysicalUnverified,
            Target::PhysicalVerified,
        ] {
            assert_eq!(
                policy.authorize(target, Operation::WriteMemory),
                Err(Denied::WritesDisabled)
            );
        }
        assert!(verify_startup_policy().is_ok());
    }

    #[test]
    fn physical_reads_require_verified_identity_with_no_simulator_fallback() {
        let policy = HardwareAccessPolicy;
        assert_eq!(
            policy.authorize(Target::PhysicalUnverified, Operation::ReadMemory),
            Err(Denied::TargetUnverified)
        );
        assert_eq!(
            policy.authorize(Target::PhysicalVerified, Operation::ReadMemory),
            Ok(())
        );
        assert_eq!(
            policy.authorize(Target::Simulator, Operation::ReadMemory),
            Ok(())
        );
        assert_ne!(Target::PhysicalUnverified, Target::Simulator);
    }
}
