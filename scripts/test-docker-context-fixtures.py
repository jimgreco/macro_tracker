#!/usr/bin/env python3
"""Fixture isolation/cleanup tests. Real image exclusions are verified by Docker CI."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
APP = 'macros' if (ROOT / 'certs/us-east-2-rds-bundle.pem').exists() else 'workouts'


class FixtureSafetyTests(unittest.TestCase):
    def exercise(self, *, tracked_collision=False, fail_build=False, invalid_ca=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo = root / 'source'
            repo.mkdir()
            scratch = root / 'scratch'
            scratch.mkdir()
            (scratch / "unrelated-keep").write_text("preserve")
            tools = root / 'tools'
            tools.mkdir()
            (repo / 'Dockerfile').write_text('FROM scratch\n')
            (repo / '.dockerignore').write_text((ROOT / '.dockerignore').read_text())
            if APP == 'macros':
                (repo / 'certs').mkdir()
                content = b'SYNTHETIC_NOT_A_CERTIFICATE' if invalid_ca else (ROOT / 'certs/us-east-2-rds-bundle.pem').read_bytes()
                (repo / 'certs/us-east-2-rds-bundle.pem').write_bytes(content)
            if tracked_collision:
                (repo / '.env').write_text('TRACKED_SYNTHETIC_FILE_KEEP\n')
            def git(*args):
                subprocess.run(['git', '-C', str(repo), *args], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            git('init', '-q')
            git('add', '.')
            git('-c', 'user.name=Fixture Test', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Synthetic fixture source')
            if not tracked_collision:
                (repo / '.env').write_text('UNTRACKED_SYNTHETIC_HOST_FILE_KEEP\n')
            before = (repo / '.env').read_bytes()
            fake = tools / 'docker'
            fake.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
with open(os.environ['FAKE_DOCKER_LOG'], 'a') as log:
    log.write(json.dumps(args) + '\\n')
if args[0] == 'build':
    context = Path(args[-1])
    assert context.joinpath('.env').read_text().startswith('SYNTHETIC_DOCKER_CONTEXT_SENTINEL=')
    assert context.joinpath('key.pem').is_file()
    assert 'UNTRACKED_SYNTHETIC_HOST_FILE_KEEP' not in context.joinpath('.env').read_text()
    if os.environ.get('FAIL_BUILD') == '1':
        raise SystemExit(42)
elif args[0] == 'create':
    print('synthetic-test-container')
elif args[0] == 'cp':
    Path(args[-1], 'index.html').write_text('synthetic public asset')
''')
            fake.chmod(0o755)
            log = root / 'docker.log'
            env = {**os.environ, 'PATH': str(tools) + os.pathsep + os.environ['PATH'],
                   'TMPDIR': str(scratch), 'FAKE_DOCKER_LOG': str(log), 'FAIL_BUILD': '1' if fail_build else '0'}
            result = subprocess.run(['bash', str(ROOT / 'scripts/check-docker-context.sh'), APP], cwd=repo,
                                    env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            calls = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
            self.assertEqual((repo / '.env').read_bytes(), before)
            self.assertFalse((repo / 'key.pem').exists())
            self.assertEqual(list(scratch.glob('health-docker-context.*')), [], 'the EXIT trap must remove its temporary fixture archive')
            self.assertEqual((scratch / 'unrelated-keep').read_text(), 'preserve')
            return result, calls

    def test_archive_omits_existing_untracked_files_and_preserves_source(self):
        result, calls = self.exercise()
        self.assertEqual(result.returncode, 0, result.stderr)
        expected_builds = 1 if APP == 'macros' else 3
        self.assertEqual(sum(call[0] == 'build' for call in calls), expected_builds)
        self.assertTrue(all('--network' in call and 'none' in call for call in calls if call[0] == 'run'))

    def test_existing_tracked_fixture_path_is_never_overwritten(self):
        result, calls = self.exercise(tracked_collision=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('FileExistsError', result.stderr)
        self.assertEqual(calls, [])

    def test_failed_build_cleans_fixture_archive_and_preserves_source(self):
        result, calls = self.exercise(fail_build=True)
        self.assertEqual(result.returncode, 42)
        self.assertEqual(sum(call[0] == 'build' for call in calls), 1)

    @unittest.skipUnless(APP == 'macros', 'Only Macrovana allowlists a public CA bundle')
    def test_public_ca_exception_rejects_non_certificate_content_before_build(self):
        result, calls = self.exercise(invalid_ca=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('only public certificates', result.stderr)
        self.assertEqual(calls, [])


if __name__ == '__main__':
    unittest.main()
