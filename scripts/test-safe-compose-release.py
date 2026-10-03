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
            if drift == 'scoped-env':
                config['services'][services[0]]['depends_on'] = {'db': {'condition': 'service_started'}}
                config['services']['db'] = {'image': 'synthetic-db'}
            if drift in ('env', 'scoped-env'):
                config['services'][services[0]]['environment']['SECRET'] = 'changed-value'
            def fake(args, input_text=None):
                commands.append(args)
                if args[:2] == ['docker', 'ps']:
                    return args[-1].split('=')[-1] + '-container'
                if args[:2] == ['docker', 'inspect']:
                    name = args[2].removesuffix('-container')
                    return json.dumps([{'Id': 'a' * 64, 'Image': name + '-old-image', 'Config': {'Env': [k+'='+v for k,v in env.items()], 'Labels': {'com.docker.compose.project': 'existing', 'com.docker.compose.project.working_dir': str(home), 'com.docker.compose.project.config_files': str(recorded), 'com.docker.compose.config-hash': 'scoped-hash' if drift == 'scoped-env' else 'known-hash'}}}])
                if args[:3] == ['docker', 'image', 'inspect']:
                    defaults = {'PATH': '/usr/bin'}
                    if drift == 'image' and '-release:' in args[3]:
                        defaults['ADDED_SECURITY_OPTION'] = 'unsafe'
                    return json.dumps([{'Config': {'Env': [k+'='+v for k,v in defaults.items()]}}])
                if args[-1] == 'config':
                    return json.dumps(config)
                if 'config' in args and '--hash' in args:
                    if drift == 'scoped-env':
                        document = json.loads(input_text) if input_text is not None else config
                        return args[-1] + (' base-hash' if 'depends_on' in document['services'][args[-1]] else ' scoped-hash')
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

    def test_scoped_hash_does_not_bypass_live_environment_comparison(self):
        commands, error, _ = self.exercise('macros', 'scoped-env')
        self.assertIn('Environment drift', error)
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


class ScopedHashTests(unittest.TestCase):
    def fixture(self, app):
        services = release.APPS[app]['services']
        config = {'name': 'existing', 'networks': {'default': {'name': 'existing_default'}},
                  'services': {name: {'environment': {'SECRET': 'synthetic-private-value'},
                                     'volumes': ['/existing:/data'], 'privileged': False}
                               for name in services}}
        outside = 'db' if app == 'macros' else 'dynamodb'
        config['services'][outside] = {'image': 'database:existing', 'volumes': ['data:/store']}
        if app == 'macros':
            config['services']['macros']['depends_on'] = {'db': {'condition': 'service_healthy', 'required': True}}
        else:
            config['services']['workout']['depends_on'] = {'workout_api': {'condition': 'service_started', 'restart': True, 'required': True}}
            config['services']['workout_api']['depends_on'] = {'dynamodb': {'condition': 'service_started', 'required': True}}
        return services, config

    @staticmethod
    def digest(document, service):
        import hashlib
        return hashlib.sha256(json.dumps(document['services'][service], sort_keys=True).encode()).hexdigest()

    def verify(self, app, *, roundtrip_drift=False, config_drift=False, drop_internal=False):
        import copy
        services, config = self.fixture(app)
        expected = copy.deepcopy(config)
        if app == 'macros':
            del expected['services']['macros']['depends_on']
        else:
            del expected['services']['workout_api']['depends_on']
            if drop_internal:
                del expected['services']['workout']['depends_on']
        live = {name: {'Config': {'Labels': {'com.docker.compose.config-hash': self.digest(expected, name)}}} for name in services}
        if config_drift:
            config['services'][services[0]]['privileged'] = True
        original = copy.deepcopy(config)
        commands, submitted = [], []
        def execute(args, input_text=None):
            commands.append(args)
            document = config
            if input_text is not None:
                self.assertEqual(args[args.index('-f') + 1], '-')
                document = json.loads(input_text)
                submitted.append(document)
                if roundtrip_drift:
                    document = copy.deepcopy(document)
                    document['services'][args[-1]]['environment']['SECRET'] = 'interpolation-changed-value'
            return args[-1] + ' ' + self.digest(document, args[-1])
        try:
            release.verify_live_hashes(['docker-compose', '-p', 'existing', '-f', '/existing/base.yml'],
                                      ['docker-compose', '-p', 'existing'], config, live, services, execute)
        except RuntimeError as error:
            return str(error), submitted, commands
        self.assertEqual(config, original, 'preflight must not mutate the rendered or shared config')
        self.assertNotIn('synthetic-private-value', json.dumps(commands))
        return None, submitted, commands

    def test_macros_accepts_only_external_dependency_removal(self):
        error, submitted, _ = self.verify('macros')
        self.assertIsNone(error)
        self.assertEqual(len(submitted), 2)
        original, scoped = submitted
        self.assertIn('db', original['services']['macros']['depends_on'])
        self.assertNotIn('depends_on', scoped['services']['macros'])
        import copy
        expected = copy.deepcopy(original)
        del expected['services']['macros']['depends_on']
        self.assertEqual(scoped, expected)

    def test_workouts_preserves_selected_service_edge_and_all_options(self):
        error, submitted, _ = self.verify('workouts')
        self.assertIsNone(error)
        self.assertEqual(len(submitted), 4)
        original, scoped = submitted[0], submitted[2]
        self.assertEqual(scoped['services']['workout'], original['services']['workout'])
        self.assertEqual(scoped['services']['dynamodb'], original['services']['dynamodb'])
        self.assertNotIn('depends_on', scoped['services']['workout_api'])
        import copy
        expected = copy.deepcopy(original)
        del expected['services']['workout_api']['depends_on']
        self.assertEqual(scoped, expected)

    def test_roundtrip_mismatch_blocks_alternate_even_with_matching_scoped_shape(self):
        error, submitted, _ = self.verify('macros', roundtrip_drift=True)
        self.assertIn('roundtrip changed', error)
        self.assertEqual(len(submitted), 1, 'do not attempt scoped hash after lossy roundtrip')
        self.assertIn('depends_on', submitted[0]['services']['macros'])

    def test_unrelated_config_change_is_still_rejected(self):
        error, _, _ = self.verify('macros', config_drift=True)
        self.assertIn('configuration drift', error)

    def test_removing_internal_workouts_dependency_is_not_accepted(self):
        error, _, _ = self.verify('workouts', drop_internal=True)
        self.assertIn('configuration drift', error)

    def test_exact_original_hash_avoids_alternate_and_secret_stdin(self):
        services, config = self.fixture('macros')
        live = {'macros': {'Config': {'Labels': {'com.docker.compose.config-hash': 'exact'}}}}
        calls = []
        def execute(args, input_text=None):
            calls.append(args)
            self.assertIsNone(input_text)
            return 'macros exact'
        release.verify_live_hashes(['docker-compose', '-f', 'base.yml'], ['docker-compose'], config, live, services, execute)
        self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main()
