"""Local deterministic API219 overlay only; no build, client or provider operation."""
import pathlib, json, hashlib, zipfile, difflib

root = pathlib.Path(__file__).resolve().parents[2]
out = root / 'release-tools/all-user-session-api-r1/release'
out.mkdir(parents=True, exist_ok=False)
sha = lambda b: hashlib.sha256(b).hexdigest()
parent = root / 'release-tools/api-ack-beta/backend.zip'
assert sha(parent.read_bytes()) == '42b7180b971262fa154571fa975db4f9ecc8387fea2abb80d926b10a9ea8210a'
with zipfile.ZipFile(parent) as z:
    manifest = json.loads(z.read('.source-manifest.json'))
    records = {f['path']: z.read(f['path']) for f in manifest['files']}
    assert len(records) == 755
    for f in manifest['files']:
        assert sha(records[f['path']]) == f['sha256'] and len(records[f['path']]) == f['bytes']
before = dict(records)

def edit(name, old, new):
    text = records[name].decode()
    assert text.count(old) == 1, name
    records[name] = text.replace(old, new).encode()

service = 'src/legacy-src/services/videoUploadService.js'
edit(service, "const { isPostVideoOwnerAllowed } = require('../config/postVideoRolloutPolicy');",
     "const { isPostVideoOwnerAllowed } = require('../config/postVideoRolloutPolicy');\nconst androidAdmission = require('./androidVideoAdmission');\nconst { WEB_VIDEO_BYTES } = require('../utils/postVideoPolicy');")
edit(service, '  maxVideoBytes: MAX_VIDEO_BYTES, maxPostVideoBytes: MAX_POST_VIDEO_BYTES, maxVideos: MAX_VIDEOS, partSize: PART_SIZE });',
     '  maxVideoBytes: WEB_VIDEO_BYTES, maxAndroidVideoBytes: MAX_VIDEO_BYTES,\n  androidUploadProofEnabled: Boolean(androidAdmission.configuration()),\n  ...(androidAdmission.configuration() ? { androidCloudProjectNumber: androidAdmission.configuration().project } : {}),\n  maxPostVideoBytes: MAX_POST_VIDEO_BYTES, maxVideos: MAX_VIDEOS, partSize: PART_SIZE });')
edit(service, '  if (!session) {\n    const token = randomUUID();',
     '  if (!session) {\n    // New larger admission needs a request-bound verified app; accepted exact sessions retain recovery.\n    await androidAdmission.assertAdmission(owner, data, input?.androidIntegrityToken);\n    const token = randomUUID();')
edit(service, "if (session.size !== data.size || session.mimeType !== data.mimeType)",
     "if (session.size !== data.size || session.mimeType !== data.mimeType || session.filename !== data.filename)")
# Deliberately preserve native API219's existing admission hook and all other session lifecycle code.
assert b"await require('../utils/jobQueue').assertVideoProcessingAdmission(owner, _id);" in records[service]
assert b'globalAdmissionOverride' not in records[service]
records['src/legacy-src/services/androidVideoAdmission.js'] = (root / 'src/legacy-src/services/androidVideoAdmission.js').read_bytes()
records['src/legacy-src/utils/postVideoPolicy.js'] = (root / 'src/legacy-src/utils/postVideoPolicy.js').read_bytes()
records['src/legacy-src/config/postVideoRolloutPolicy.js'] = (root / 'src/legacy-src/config/postVideoRolloutPolicy.js').read_bytes()
controller = 'src/legacy-src/controllers/postController.js'
edit(controller, '    if (reservedPostId) publicationLease = await acquirePublication(authorId, reservedPostId);',
     "    // Session-only release: retain existing idempotent Posts above, never accept new raw legacy video.\n    if (mediaFiles.some(file => String(file.mimetype || '').startsWith('video/'))) {\n      return res.status(409).json({ success: false, code: 'VIDEO_UPLOAD_PATH_REQUIRED', message: 'Refresh the composer and upload this video through the reserved video upload flow.' });\n    }\n    if (reservedPostId) publicationLease = await acquirePublication(authorId, reservedPostId);")

changes = []
patches = []
for name in sorted(records):
    if before.get(name) == records[name]:
        continue
    changes.append({'path': name, 'beforeSha256': sha(before[name]) if name in before else None, 'sha256': sha(records[name]), 'bytes': len(records[name])})
    patches += list(difflib.unified_diff(before.get(name, b'').decode().splitlines(True), records[name].decode().splitlines(True), fromfile='a/' + name if name in before else '/dev/null', tofile='b/' + name))
assert len(changes) == 5 and len(records) == 756
for name in records:
    assert not name.startswith('/') and '..' not in pathlib.PurePosixPath(name).parts and '\\' not in name
    assert not pathlib.PurePosixPath(name).name.startswith('.env') or name.endswith('.example')
for name in ['Dockerfile', 'package.json', 'package-lock.json', 'src/legacy-src/models/Post.js', 'scripts/migrate-video-upload-indexes.js', 'src/legacy-src/services/pendingVideoPostService.js', 'src/legacy-src/utils/postVideoDelivery.js']:
    assert records[name] == before[name]
files = [{'path': name, 'bytes': len(b), 'sha256': sha(b)} for name, b in sorted(records.items())]
content = sha(json.dumps(files, separators=(',', ':'), ensure_ascii=False).encode())
newmanifest = {'kind': 'API219_SESSION_ONLY_SOURCE_NOT_BUILT', 'parentArchiveSha256': sha(parent.read_bytes()), 'sourceContentSha256': content, 'files': files}
manifestbytes = (json.dumps(newmanifest, indent=2) + '\n').encode()
(out / 'source-manifest.json').write_bytes(manifestbytes)
with zipfile.ZipFile(out / 'source.zip', 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name, b in sorted({**records, '.source-manifest.json': manifestbytes}.items()):
        info = zipfile.ZipInfo(name, (2026, 11, 1, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED; info.external_attr = 0o100644 << 16
        z.writestr(info, b, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
(out / 'session-only-api.patch').write_text(''.join(patches))
candidate = {'kind': 'SESSION_ONLY_API_SOURCE_PREPARED_NOT_BUILT', 'nativeBaselineDefinition': 'arc-backend:219', 'nativeBaselineIndex': 'sha256:c6e1708fdc0b05a4a56105759200f517cc906611b1692a0cf37691dcd4ecc9c1', 'sourceFiles': len(files), 'sourceContentSha256': content, 'sourceArchiveSha256': sha((out / 'source.zip').read_bytes()), 'changes': changes, 'privateLegacySupported': False, 'indexChanges': 0, 'ledgerOrAdmissionHookChanges': 0, 'runtimeControlChanges': 0, 'apiImageDigest': None, 'taskDefinitionInput': None, 'providerAuthority': 0, 'blockers': ['normal source review/merge', 'exact build/push controller and fresh separate publication approval', 'native accepted-work/data coverage and capacity safety', 'current full Task/Service parent comparison before registration', 'matching worker format qualification', 'native app Integrity configuration for larger Android admission', 'non-canary gallery upload and private playback qualification']}
(out / 'candidate.json').write_text(json.dumps(candidate, indent=2) + '\n')
print(json.dumps({k: candidate[k] for k in ['sourceFiles', 'sourceContentSha256', 'sourceArchiveSha256', 'indexChanges', 'providerAuthority']}))
