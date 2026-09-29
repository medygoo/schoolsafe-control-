import {describe, expect, it} from 'vitest';
import {generateKeyPairSync, verify} from 'node:crypto';
import {buildApp} from '../src/app.js';
import {SqliteDatabase} from '../src/db/sqlite.js';
import {PostgresDatabase} from '../src/db/postgres.js';
import {signRequest} from '../src/auth/hmac.js';

describe('perpetual license admin issuance',()=>{
  it('requires explicit admin authorization and preserves school binding and signature',async()=>{
    const url=process.env.CONTROL_PERPETUAL_TEST_DATABASE_URL;
    if(url){const target=new URL(url);expect(['127.0.0.1','localhost']).toContain(target.hostname);expect(target.pathname).toMatch(/^\/control_test_[a-z0-9_]+$/);}
    const db=url?new PostgresDatabase(url):new SqliteDatabase(':memory:');await db.init();
    const now=new Date().toISOString();
    const instance=await db.createInstance({school_name:'Test',school_slug:'test',domain:'test',api_base:'https://test',supabase_url:'https://test',status:'active',setup_token:null,hmac_secret:'h'.repeat(32),trial_started_at:now,grace_ends_at:null,activated_at:now,created_at:now,updated_at:now});
    const school='33333333-3333-4333-8333-333333333333';
    const keys=generateKeyPairSync('ed25519');
    const app=await buildApp({db,adminToken:'test-admin',licensePrivateKey:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString()});
    try {
      const payload={school_id:school,license_id:'perpetual-test',status:'active',issued_at:now,expires_at:null,grace_days:0,metadata:{perpetual:true}};
      const url='/instances/'+instance.id+'/license';
      expect((await app.inject({method:'PUT',url,payload})).statusCode).toBe(401);
      for(const invalid of [{...payload,metadata:{}},{...payload,grace_days:1},{...payload,expires_at:undefined},{...payload,expires_at:'2030-01-01T00:00:00Z'}]) {
        expect((await app.inject({method:'PUT',url,headers:{'x-admin-token':'test-admin'},payload:invalid})).statusCode).toBe(400);
      }
      expect((await app.inject({method:'PUT',url,headers:{'x-admin-token':'test-admin'},payload})).statusCode).toBe(200);
      expect((await db.getLicense(instance.id,school))?.expires_at).toBeNull();
      const path='/api/license/state?school_id='+school;const timestamp=Math.floor(Date.now()/1000);
      const response=await app.inject({method:'GET',url:path,headers:{'x-schoolsafe-instance':instance.id,'x-schoolsafe-timestamp':String(timestamp),'x-schoolsafe-signature':signRequest({method:'GET',path,timestamp,body:'{}',secret:instance.hmac_secret})}});
      expect(response.statusCode).toBe(200);
      const [body,sig]=response.json().signed_token.split('.');
      expect(verify(null,Buffer.from(body),keys.publicKey,Buffer.from(sig,'base64url'))).toBe(true);
      expect(JSON.parse(Buffer.from(body,'base64url').toString())).toMatchObject({school_id:school,expires_at:null,perpetual:true});
      const otherPath='/api/license/state?school_id=44444444-4444-4444-8444-444444444444';
      expect((await app.inject({method:'GET',url:otherPath,headers:{'x-schoolsafe-instance':instance.id,'x-schoolsafe-timestamp':String(timestamp),'x-schoolsafe-signature':signRequest({method:'GET',path:otherPath,timestamp,body:'{}',secret:instance.hmac_secret})}})).statusCode).toBe(403);
      // Existing null rows without the new marker must not gain unlimited rights.
      await db.upsertLicense({...payload,instance_id:instance.id,status:'active',metadata:{}});
      expect(await db.getLicense(instance.id,school)).toBeUndefined();
    } finally {await app.close();await db.close();}
  });
});
