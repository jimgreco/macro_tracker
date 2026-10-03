#!/usr/bin/env python3
"""Fail-closed app release using the running containers' existing Compose inputs.

No shared configuration, credentials, database grants, or image cleanup is changed.
Requires the same Compose implementation used to create the running containers.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

APPS = {
    'macros': {'services': ['macros'], 'directory': 'macros', 'metadata': ['APP_BUILD']},
    'workouts': {'services': ['workout', 'workout_api'], 'directory': 'workout_planner', 'metadata': ['GIT_COMMIT', 'BUILD_TIME']},
}


def run(args):
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        # Config/build stderr may contain interpolated credentials. Do not echo it.
        raise RuntimeError('Command failed: ' + args[0] + ' ' + args[1] + ' (details withheld)')
    return result.stdout


def envmap(values):
    return dict(item.split('=', 1) for item in values or [] if '=' in item)


def decoded_config(compose, execute):
    # Compose v1 emits YAML. Parse locally; never print resolved configuration.
    source = execute(compose + ['config'])
    try:
        return json.loads(source)
    except json.JSONDecodeError:
        try:
            import yaml
        except ImportError:
            raise RuntimeError('PyYAML is required to validate Compose v1 configuration') from None
        try:
            return yaml.safe_load(source)
        except yaml.YAMLError:
            raise RuntimeError('Compose configuration could not be parsed (details withheld)') from None


def release(app, sha, execute=run, home=None, preflight_only=False):
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise RuntimeError('A full 40-character commit SHA is required')
    spec = APPS[app]
    services = spec['services']
    home = Path(home or Path.home())
    live = {}
    contract = None
    for service in services:
        ids = execute(['docker', 'ps', '-q', '--filter', 'label=com.docker.compose.service=' + service]).split()
        if len(ids) != 1:
            raise RuntimeError('Expected exactly one running container for ' + service)
        item = json.loads(execute(['docker', 'inspect', ids[0]]))[0]
        labels = item['Config']['Labels']
        selected = (labels.get('com.docker.compose.project'), labels.get('com.docker.compose.project.working_dir'), labels.get('com.docker.compose.project.config_files'))
        if not all(selected) or (contract and selected != contract):
            raise RuntimeError('Missing or inconsistent live Compose labels')
        contract = selected
        live[service] = item
    project, workdir, files = contract
    if not Path(workdir).is_dir():
        raise RuntimeError('Live Compose working directory is missing')
    paths = [Path(p) if Path(p).is_absolute() else Path(workdir) / p for p in files.split(',')]
    if not all(p.is_file() for p in paths):
        # Historical Workouts releases deleted their temporary override. The
        # existing durable pair is usable only if every service hash below is
        # identical to the live labels; environment equality is checked too.
        durable = [Path(workdir) / 'docker-compose.yml', Path(workdir) / 'docker-compose.override.yml']
        if app != 'workouts' or not all(p.is_file() for p in durable):
            raise RuntimeError('A live Compose input is missing; reconcile it before release')
        paths = durable
    # Prefer legacy Compose when installed so config hashes remain comparable.
    import shutil
    binary = ['docker-compose'] if shutil.which('docker-compose') else ['docker', 'compose']
    compose = binary + ['--project-directory', workdir, '-p', project]
    for path in paths:
        compose += ['-f', str(path)]
    # Prior Macrovana releases provided this public interpolation value in the
    # deploy shell rather than persisting it. Reconstruct only that metadata.
    if app == 'macros':
        os.environ['APP_BUILD'] = envmap(live['macros']['Config'].get('Env')).get('APP_BUILD', '')
    config = decoded_config(compose, execute)
    for service in services:
        item = live[service]
        # This blocks any on-disk drift, including security, volumes, and networking.
        calculated = execute(compose + ['config', '--hash', service]).strip().split()
        expected = item['Config']['Labels'].get('com.docker.compose.config-hash')
        if len(calculated) != 2 or calculated[0] != service or calculated[1] != expected:
            raise RuntimeError('Live Compose configuration drift for ' + service + '; reconcile before release')
        svc = config['services'][service]
        build = svc.get('build', {})
        context = build.get('context') if isinstance(build, dict) else build
        if context is None or Path(context).resolve() != (home / spec['directory']).resolve():
            raise RuntimeError('Unexpected build context for ' + service)
        old_defaults = envmap(json.loads(execute(['docker', 'image', 'inspect', item['Image']]))[0]['Config'].get('Env'))
        configured = svc.get('environment') or {}
        if isinstance(configured, list):
            configured = envmap(configured)
        intended = {**old_defaults, **{k: str(v) for k, v in configured.items() if v is not None}}
        actual = envmap(item['Config'].get('Env'))
        changed = sorted(k for k in set(intended) | set(actual) if intended.get(k) != actual.get(k))
        if changed:
            raise RuntimeError('Environment drift for ' + service + ': ' + ', '.join(changed))
    if preflight_only:
        print(json.dumps({'app': app, 'sha': sha, 'preflight': 'passed', 'project': project, 'services': services}))
        return
    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    build_time = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    overlay = {'services': {}}
    rollback = {}
    for service in services:
        rollback[service] = service.replace('_', '-') + '-rollback:' + stamp + '-' + live[service]['Id'][:12]
        execute(['docker', 'tag', live[service]['Image'], rollback[service]])
        metadata = {'APP_BUILD': sha[:7]} if app == 'macros' else ({'GIT_COMMIT': sha[:7], 'BUILD_TIME': build_time} if service == 'workout_api' else {})
        overlay['services'][service] = {'image': service.replace('_', '-') + '-release:' + sha, 'environment': metadata}
        if app == 'workouts' and service == 'workout':
            overlay['services'][service]['build'] = {'target': 'frontend-prebuilt'}
    with tempfile.NamedTemporaryFile(mode='w', prefix='app-release-', suffix='.json', dir=workdir, delete=False) as handle:
        json.dump(overlay, handle)
        handle.flush()
        selected = compose + ['-f', handle.name]
        execute(selected + ['build'] + services)
        # New Dockerfile defaults must also preserve runtime settings.
        for service in services:
            new_defaults = envmap(json.loads(execute(['docker', 'image', 'inspect', overlay['services'][service]['image']]))[0]['Config'].get('Env'))
            svc = config['services'][service]
            configured = svc.get('environment') or {}
            if isinstance(configured, list):
                configured = envmap(configured)
            intended = {**new_defaults, **{k: str(v) for k, v in configured.items() if v is not None}, **overlay['services'][service]['environment']}
            actual = envmap(live[service]['Config'].get('Env'))
            changed = sorted(k for k in set(intended) | set(actual) if k not in spec['metadata'] and intended.get(k) != actual.get(k))
            if changed:
                raise RuntimeError('New image environment drift for ' + service + ': ' + ', '.join(changed))
        execute(selected + ['up', '-d', '--no-deps', '--no-build', '--force-recreate'] + services)
    # Keep this metadata-only overlay: the running containers' labels reference it.
    print(json.dumps({'app': app, 'sha': sha, 'project': project, 'overlay': handle.name, 'rollback_images': rollback}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('app', choices=APPS)
    parser.add_argument('sha')
    parser.add_argument('--check', action='store_true', help='Validate existing live configuration without building or recreating')
    args = parser.parse_args()
    # Shared across app-local workflows on this host, independent of GitHub repo.
    with open('/tmp/codex-shared-host-release.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            release(args.app, args.sha, preflight_only=args.check)
        except Exception as error:
            raise SystemExit(str(error)) from None


if __name__ == '__main__':
    main()
