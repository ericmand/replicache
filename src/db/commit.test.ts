import {expect} from '@esm-bundle/chai';
import {Chunk} from '../dag/mod';
import * as dag from '../dag/mod';
import {MemStore} from '../kv/mod';
import {
  Commit,
  CommitData,
  fromChunk,
  IndexChangeMeta,
  Meta,
  MetaTyped,
  newIndexChange as commitNewIndexChange,
  newLocal as commitNewLocal,
  newSnapshot as commitNewSnapshot,
  SnapshotMeta,
} from './commit';
import {
  addGenesis,
  addIndexChange,
  addLocal,
  addSnapshot,
  Chain,
} from './test-helpers';
import {initHasher} from '../hash';
import type {JSONValue} from '../json';

setup(async () => {
  await initHasher();
});

test('base snapshot', async () => {
  const store = new dag.Store(new MemStore());
  const chain: Chain = [];
  await addGenesis(chain, store);
  let genesisHash = chain[0].chunk.hash;
  await store.withRead(async dagRead => {
    expect(
      (await Commit.baseSnapshot(genesisHash, dagRead)).chunk.hash,
    ).to.equal(genesisHash);
  });

  await addLocal(chain, store);
  await addIndexChange(chain, store);
  await addLocal(chain, store);
  genesisHash = chain[0].chunk.hash;
  await store.withRead(async dagRead => {
    expect(
      (await Commit.baseSnapshot(chain[chain.length - 1].chunk.hash, dagRead))
        .chunk.hash,
    ).to.equal(genesisHash);
  });

  await addSnapshot(chain, store, undefined);
  const baseHash = await store.withRead(async dagRead => {
    const baseHash = await dagRead.getHead('main');
    expect(
      (await Commit.baseSnapshot(chain[chain.length - 1].chunk.hash, dagRead))
        .chunk.hash,
    ).to.equal(baseHash);
    return baseHash;
  });

  await addLocal(chain, store);
  await addLocal(chain, store);
  await store.withRead(async dagRead => {
    expect(
      (await Commit.baseSnapshot(chain[chain.length - 1].chunk.hash, dagRead))
        .chunk.hash,
    ).to.equal(baseHash);
  });
});

test('local mutations', async () => {
  const store = new dag.Store(new MemStore());
  const chain: Chain = [];
  await addGenesis(chain, store);
  const genesisHash = chain[0].chunk.hash;
  await store.withRead(async dagRead => {
    expect(await Commit.localMutations(genesisHash, dagRead)).to.have.lengthOf(
      0,
    );
  });

  await addLocal(chain, store);
  await addIndexChange(chain, store);
  await addLocal(chain, store);
  await addIndexChange(chain, store);
  const headHash = chain[chain.length - 1].chunk.hash;
  const commits = await store.withRead(dagRead =>
    Commit.localMutations(headHash, dagRead),
  );
  expect(commits).to.have.lengthOf(2);
  expect(commits[0]).to.deep.equal(chain[3]);
  expect(commits[1]).to.deep.equal(chain[1]);
});

test('chain', async () => {
  const store = new dag.Store(new MemStore());
  const chain: Chain = [];
  await addGenesis(chain, store);

  let got = await store.withRead(dagRead =>
    Commit.chain(chain[chain.length - 1].chunk.hash, dagRead),
  );

  expect(got).to.have.lengthOf(1);
  expect(got[0]).to.deep.equal(chain[0]);

  await addSnapshot(chain, store, undefined);
  await addLocal(chain, store);
  await addIndexChange(chain, store);
  const headHash = chain[chain.length - 1].chunk.hash;
  got = await store.withRead(dagRead => Commit.chain(headHash, dagRead));
  expect(got).to.have.lengthOf(3);
  expect(got[0]).to.deep.equal(chain[3]);
  expect(got[1]).to.deep.equal(chain[2]);
  expect(got[2]).to.deep.equal(chain[1]);
});

test('load roundtrip', async () => {
  const t = (chunk: Chunk, expected: Commit | Error) => {
    {
      if (expected instanceof Error) {
        expect(() => fromChunk(chunk)).to.throw(
          expected.constructor,
          expected.message,
        );
      } else {
        const actual = fromChunk(chunk);
        expect(actual).to.deep.equal(expected);
      }
    }
  };
  for (const basisHash of [null, '', 'hash']) {
    t(
      await makeCommit(
        {
          type: MetaTyped.Local,
          basisHash,
          mutationID: 0,
          mutatorName: 'mutname',
          mutatorArgsJSON: 42,
          originalHash: 'original',
        },
        'value',
        basisHash === null ? ['value'] : ['value', basisHash],
      ),
      await commitNewLocal(
        basisHash,
        0,
        'mutname',
        42,
        'original',
        'value',
        [],
      ),
    );
  }

  t(
    await makeCommit(
      {
        type: MetaTyped.Local,
        basisHash: 'basis',
        mutationID: 0,
        mutatorName: '',
        mutatorArgsJSON: 43,
        originalHash: '',
      },
      'value-hash',
      ['', ''],
    ),
    new Error('Missing mutator name'),
  );
  t(
    await makeCommit(
      {
        type: MetaTyped.Local,
        basisHash: '',
        mutationID: 0,
        // @ts-expect-error We are testing invalid types
        mutatorName: undefined,
        mutatorArgsJSON: 43,
        originalHash: '',
      },
      'value-hash',
      ['', ''],
    ),
    new Error('Invalid type: undefined, expected string'),
  );

  for (const basisHash of [null, '', 'hash']) {
    t(
      await makeCommit(
        {
          type: MetaTyped.Local,
          basisHash,
          mutationID: 0,
          mutatorName: 'mutname',
          mutatorArgsJSON: 44,
          originalHash: null,
        },
        'vh',
        basisHash === null ? ['vh'] : ['vh', basisHash],
      ),
      await commitNewLocal(basisHash, 0, 'mutname', 44, null, 'vh', []),
    );
  }

  t(
    await makeCommit(
      {
        type: MetaTyped.Local,
        basisHash: '',
        mutationID: 0,
        mutatorName: 'mutname',
        mutatorArgsJSON: 45,
        originalHash: '',
      },

      //@ts-expect-error we are testing invalid types
      undefined,
      ['', ''],
    ),
    new Error('Invalid type: undefined, expected string'),
  );

  const cookie = {foo: 'bar'};
  for (const basisHash of [null, '', 'hash']) {
    t(
      await makeCommit(
        makeSnapshotMeta(basisHash ?? null, 0, {foo: 'bar'}),
        'vh',
        ['vh'],
      ),
      await commitNewSnapshot(basisHash, 0, cookie, 'vh', []),
    );
  }
  t(
    await makeCommit(
      makeSnapshotMeta(
        '',
        0,
        // @ts-expect-error we are testing invalid types
        undefined,
      ),
      'vh',
      ['vh', ''],
    ),
    new Error('Invalid type: undefined, expected JSON value'),
  );

  for (const basisHash of [null, '', 'hash']) {
    t(
      await makeCommit(
        makeIndexChangeMeta(basisHash, 0),
        'value',
        basisHash === null ? ['value'] : ['value', basisHash],
      ),
      await commitNewIndexChange(basisHash, 0, 'value', []),
    );
  }
});

test('accessors', async () => {
  const local = fromChunk(
    await makeCommit(
      {
        basisHash: 'basis_hash',
        type: MetaTyped.Local,
        mutationID: 1,
        mutatorName: 'foo_mutator',
        mutatorArgsJSON: 42,
        originalHash: 'original_hash',
      },
      'value_hash',
      ['value_hash', 'basis_hash'],
    ),
  );
  const lm = local.meta;
  if (lm.type === MetaTyped.Local) {
    expect(lm.mutationID).to.equal(1);
    expect(lm.mutatorName).to.equal('foo_mutator');
    expect(lm.mutatorArgsJSON).to.equal(42);
    expect(lm.originalHash).to.equal('original_hash');
  } else {
    throw new Error('unexpected type');
  }
  expect(local.meta.basisHash).to.equal('basis_hash');
  expect(local.valueHash).to.equal('value_hash');
  expect(local.nextMutationID).to.equal(2);

  const snapshot = fromChunk(
    await makeCommit(
      makeSnapshotMeta('basis_hash_2', 2, 'cookie 2'),
      'value_hash 2',
      ['value_hash 2', 'basis_hash_2'],
    ),
  );
  const sm = snapshot.meta;
  if (sm.type === MetaTyped.Snapshot) {
    expect(sm.lastMutationID).to.equal(2);
    expect(sm.cookieJSON).to.deep.equal('cookie 2');
    expect(sm.cookieJSON).to.deep.equal('cookie 2');
  } else {
    throw new Error('unexpected type');
  }
  expect(snapshot.meta.basisHash).to.equal('basis_hash_2');
  expect(snapshot.valueHash).to.equal('value_hash 2');
  expect(snapshot.nextMutationID).to.equal(3);

  const indexChange = fromChunk(
    await makeCommit(makeIndexChangeMeta('basis_hash 3', 3), 'value_hash 3', [
      'value_hash 3',
      'basis_hash 3',
    ]),
  );
  const ic = indexChange.meta;
  if (ic.type === MetaTyped.IndexChange) {
    expect(ic.lastMutationID).to.equal(3);
  } else {
    throw new Error('unexpected type');
  }
  expect(indexChange.meta.basisHash).to.equal('basis_hash 3');
  expect(indexChange.valueHash).to.equal('value_hash 3');
  expect(indexChange.mutationID).to.equal(3);
});

async function makeCommit(
  meta: Meta,
  valueHash: string,
  refs: string[],
): Promise<Chunk> {
  const data: CommitData = {
    meta,
    valueHash,
    indexes: [],
  };

  return Chunk.new(data, refs);
}

function makeSnapshotMeta(
  basisHash: string | null,
  lastMutationID: number,
  cookieJSON: JSONValue,
): SnapshotMeta {
  return {
    type: MetaTyped.Snapshot,
    basisHash,
    lastMutationID,
    cookieJSON,
  };
}

function makeIndexChangeMeta(
  basisHash: string | null,
  lastMutationID: number,
): IndexChangeMeta {
  return {
    type: MetaTyped.IndexChange,
    basisHash,
    lastMutationID,
  };
}
