import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("deploy", Path(__file__).with_name("deploy.py"))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
SHA = "a" * 40


def good_run(**changes):
    return {"id": 1, "run_attempt": 1, "head_sha": SHA, "head_branch": "main",
            "event": "push", "status": "completed", "conclusion": "success",
            "head_repository": {"full_name": deploy.REPO}, **changes}


class ApprovalTests(unittest.TestCase):
    def test_only_current_main_success_is_eligible(self):
        self.assertTrue(deploy.approved(SHA, {"object": {"sha": SHA}}, [good_run()]))
        self.assertFalse(deploy.approved(SHA, {"object": {"sha": "b" * 40}}, [good_run()]))
        self.assertFalse(deploy.approved(SHA, {"object": {"sha": SHA}}, []))

    def test_pending_failure_pr_fork_and_wrong_sha_are_denied(self):
        for change in [{"status": "in_progress"}, {"conclusion": "failure"},
                       {"conclusion": "cancelled"}, {"event": "pull_request"},
                       {"head_branch": "feature"}, {"head_sha": "b" * 40},
                       {"head_repository": {"full_name": "other/bnbera"}}]:
            with self.subTest(change=change):
                self.assertFalse(deploy.approved(SHA, {"object": {"sha": SHA}}, [good_run(**change)]))

    def test_latest_failed_rerun_overrides_old_success(self):
        self.assertFalse(deploy.approved(SHA, {"object": {"sha": SHA}},
                         [good_run(), good_run(run_attempt=2, conclusion="failure")]))

    def test_ssh_command_injection_is_denied_before_config_or_commands(self):
        for command in ["main", SHA + "; id", "--help", "$(id)", ""]:
            with self.subTest(command=command), patch.dict("os.environ", {"SSH_ORIGINAL_COMMAND": command}), patch.object(deploy.sys, "argv", ["deploy.py"]), patch.object(deploy, "run") as run:
                with self.assertRaisesRegex(RuntimeError, "EXPECTED_EXACT_COMMIT_SHA"):
                    deploy.main()
                run.assert_not_called()


class PromotionTests(unittest.TestCase):
    def test_health_failure_restores_previous_dropin_and_restarts(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(deploy, "run") as run:
            dropin, pending = Path(directory) / "override.conf", Path(directory) / "pending.json"
            dropin.write_text("previous release")
            def fail():
                self.assertEqual(dropin.read_text(), "candidate release")
                self.assertEqual(json.loads(pending.read_text())["previous"], "previous release")
                raise RuntimeError("HEALTH_CHECK_FAILED")
            with self.assertRaisesRegex(RuntimeError, "HEALTH_CHECK_FAILED"):
                deploy.promote(dropin, "candidate release", pending, fail)
            self.assertEqual(dropin.read_text(), "previous release")
            self.assertFalse(pending.exists())
            self.assertEqual(run.call_count, 4)

    def test_first_deploy_failure_removes_override_restoring_original_service(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(deploy, "run"):
            dropin, pending = Path(directory) / "override.conf", Path(directory) / "pending.json"
            with self.assertRaises(RuntimeError):
                deploy.promote(dropin, "candidate", pending, lambda: (_ for _ in ()).throw(RuntimeError()))
            self.assertFalse(dropin.exists())
            self.assertFalse(pending.exists())

    def test_restart_failure_rolls_back_before_health_check(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(deploy, "run", side_effect=[None, RuntimeError("restart"), None, None]):
            dropin, pending = Path(directory) / "override.conf", Path(directory) / "pending.json"
            dropin.write_text("previous")
            with self.assertRaises(RuntimeError):
                deploy.promote(dropin, "candidate", pending, lambda: self.fail("must not reach health"))
            self.assertEqual(dropin.read_text(), "previous")

    def test_success_keeps_verified_release(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(deploy, "run"):
            dropin, pending = Path(directory) / "override.conf", Path(directory) / "pending.json"
            deploy.promote(dropin, "candidate", pending, lambda: self.assertTrue(pending.exists()))
            self.assertEqual(dropin.read_text(), "candidate")
            self.assertFalse(pending.exists())

    def test_failed_rollback_keeps_journal_for_recovery(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(deploy, "run", side_effect=RuntimeError("restart")):
            dropin, pending = Path(directory) / "override.conf", Path(directory) / "pending.json"
            dropin.write_text("previous")
            with self.assertRaises(RuntimeError):
                deploy.promote(dropin, "candidate", pending, lambda: None)
            self.assertEqual(json.loads(pending.read_text())["previous"], "previous")


if __name__ == "__main__":
    unittest.main()
