#!/usr/bin/env python3
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('safe-compose-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class SafeReleaseTests(unittest.TestCase):
    def exercise(self, app, drift=None):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            base = home / 'docker-compose.yml'
            base.write_text('fixture')
            recorded = base
            if drift in ('missing-recorded', 'missing-mismatch'):
                recorded = home / 'deleted-temporary-override.yml'
                (home / 'docker-compose.override.yml').write_text('existing durable override')
            appdir = home / release.APPS[app]['directory']
            appdir.mkdir()
            commands = []
            services = release.APPS[app]['services']
            env = {'NODE_ENV': 'production', 'SECRET': 'synthetic-local-value', 'PATH': '/usr/bin'}
            config = {'services': {name: {'build': {'context': str(appdir)}, 'environment': {'NODE_ENV': 'production', 'SECRET': 'synthetic-local-value'}} for name in services}}
            if drift == 'env':
                config['services'][services[0]]['environment']['SECRET'] = 'changed-value'
            def fake(args):
                commands.append(args)
                if args[:2] == ['docker', 'ps']:
                    return args[-1].split('=')[-1] + '-container'
                if args[:2] == ['docker', 'inspect']:
                    name = args[2].removesuffix('-container')
                    return json.dumps([{'Id': 'a' * 64, 'Image': name + '-old-image', 'Config': {'Env': [k+'='+v for k,v in env.items()], 'Labels': {'com.docker.compose.project': 'existing', 'com.docker.compose.project.working_dir': str(home), 'com.docker.compose.project.config_files': str(recorded), 'com.docker.compose.config-hash': 'known-hash'}}}])
                if args[:3] == ['docker', 'image', 'inspect']:
                    defaults = {'PATH': '/usr/bin'}
                    if drift == 'image' and '-release:' in args[3]:
                        defaults['ADDED_SECURITY_OPTION'] = 'unsafe'
                    return json.dumps([{'Config': {'Env': [k+'='+v for k,v in defaults.items()]}}])
                if args[-1] == 'config':
                    return json.dumps(config)
                if 'config' in args and '--hash' in args:
                    return args[-1] + (' bad-hash' if drift in ('config', 'missing-mismatch') else ' known-hash')
                return ''
            output = io.StringIO()
            try:
                with contextlib.redirect_stdout(output):
                    release.release(app, 'b' * 40, execute=fake, home=home)
            except RuntimeError as error:
                return commands, str(error), list(home.glob('app-release-*'))
            serialized = json.dumps(commands)
            self.assertNotIn('synthetic-local-value', serialized)
            self.assertNotIn('synthetic-local-value', output.getvalue())
            self.assertNotIn('prune', serialized)
            self.assertNotIn('down', serialized)
            self.assertEqual(base.read_text(), 'fixture')
            overlays = list(home.glob('app-release-*'))
            self.assertEqual(len(overlays), 1)
            self.assertNotIn('SECRET', overlays[0].read_text())
            self.assertFalse((home / '.env').exists())
            return commands, None, overlays

    def test_targeted_recreate_and_rollback_images(self):
        for app in release.APPS:
            with self.subTest(app=app):
                commands, error, _ = self.exercise(app)
                self.assertIsNone(error)
                services = release.APPS[app]['services']
                updates = [c for c in commands if 'up' in c]
                self.assertEqual(len(updates), 1)
                self.assertEqual(updates[0][updates[0].index('up'):], ['up', '-d', '--no-deps', '--no-build', '--force-recreate'] + services)
                tags = [c for c in commands if c[:2] == ['docker', 'tag']]
                self.assertEqual(len(tags), len(services))
                self.assertTrue(all('-rollback:' in c[-1] for c in tags))
                self.assertLess(commands.index(tags[-1]), commands.index(updates[0]))

    def test_config_drift_stops_before_tag_build_or_up(self):
        commands, error, _ = self.exercise('macros', 'config')
        self.assertIn('configuration drift', error)
        self.assertFalse(any('up' in c or 'build' in c or 'tag' in c for c in commands))

    def test_secret_drift_reports_key_only_before_mutation(self):
        commands, error, _ = self.exercise('workouts', 'env')
        self.assertIn('SECRET', error)
        self.assertNotIn('value', error)
        self.assertFalse(any('up' in c or 'build' in c or 'tag' in c for c in commands))

    def test_deleted_workouts_overlay_uses_only_exact_hash_durable_pair(self):
        commands, error, _ = self.exercise('workouts', 'missing-recorded')
        self.assertIsNone(error)
        updates = [c for c in commands if 'up' in c]
        self.assertTrue(any(c.endswith('docker-compose.override.yml') for c in updates[0]))
        self.assertFalse(any('deleted-temporary-override' in c for c in updates[0]))

    def test_missing_overlay_durable_hash_mismatch_still_stops(self):
        commands, error, _ = self.exercise('workouts', 'missing-mismatch')
        self.assertIn('configuration drift', error)
        self.assertFalse(any('up' in c or 'build' in c or 'tag' in c for c in commands))

    def test_new_image_environment_drift_blocks_restart(self):
        commands, error, _ = self.exercise('macros', 'image')
        self.assertIn('ADDED_SECURITY_OPTION', error)
        self.assertFalse(any('up' in c for c in commands))
        self.assertTrue(any('tag' in c for c in commands))


if __name__ == '__main__':
    unittest.main()
