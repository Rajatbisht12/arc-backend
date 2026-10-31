// Disposable LOCAL user. No live cluster or existing application credential.
db.getSiblingDB('admin').createUser({ user:'worker7_local',
  pwd:'worker7-local-mongo-not-a-cloud-secret',
  roles:[{ role:'readWrite', db:'worker7_local_rehearsal' }] });
