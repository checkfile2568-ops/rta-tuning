'use strict';
/**
 * My Music Library owner-only Passkey backend.
 * Deploy to Firebase Cloud Functions v2 (Node 20).
 * Configure OWNER_UID and WEB_ORIGIN in the functions environment before deploy.
 */
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const {
  generateRegistrationOptions,verifyRegistrationResponse,
  generateAuthenticationOptions,verifyAuthenticationResponse,
}=require('@simplewebauthn/server');
const crypto=require('node:crypto');
admin.initializeApp();
const firestore=admin.firestore();
const REGION='asia-southeast1';
const origin=process.env.WEB_ORIGIN||'https://checkfile2568-ops.github.io';
const rpId=new URL(origin).hostname;
const ownerUid=process.env.OWNER_UID;
const expiryMs=5*60*1000;
const take=(s,max)=>typeof s==='string'&&s.length<=max?s:null;
const failure=(res,status,message)=>res.status(status).json({message});
const challenges=firestore.collection('musicPasskeyChallenges');
const credentials=firestore.collection('musicPasskeys');

async function requireOwner(req){
  const authorization=req.headers.authorization||'';
  if(!authorization.startsWith('Bearer '))throw Error('unauthorized');
  const t=await admin.auth().verifyIdToken(authorization.slice(7),true);
  if(!ownerUid||t.uid!==ownerUid)throw Error('forbidden');
  return t;
}
async function takeChallenge(id,type){
  if(!take(id,128))throw Error('bad request');
  const ref=challenges.doc(id);
  return firestore.runTransaction(async tx=>{
    const snapshot=await tx.get(ref);
    if(!snapshot.exists)throw Error('expired challenge');
    const data=snapshot.data();
    tx.delete(ref); // Consume exactly once even on invalid response
    if(data.type!==type||data.expiresAt<Date.now())throw Error('expired challenge');
    return data;
  });
}
const makeRequestId=()=>crypto.randomBytes(24).toString('base64url');
async function dispatch(req,res){
  const path=req.path.replace(/\\/+$/,'');
  if(!ownerUid)return failure(res,503,'OWNER_UID not configured');
  if(req.method!=='POST')return failure(res,405,'POST required');
  if(req.headers.origin!==origin)return failure(res,403,'Untrusted origin');
  // A hostile site cannot bypass these checks through a browser CORS request
  if(!['application/json'].some(m=>(req.headers['content-type']||'').startsWith(m)))return failure(res,415,'JSON required');
  const body=req.body||{};
  if(path==='/webauthn/register/options'){
    const user=await requireOwner(req);
    const existing=await credentials.where('uid','==',user.uid).limit(100).get();
    const excludeCredentials=existing.docs.map(d=>({id:d.id,type:'public-key'}));
    const options=await generateRegistrationOptions({
      rpName:'My Music Library',rpID:rpId,
      userID:Buffer.from(user.uid,'utf8'),userName:user.email||user.uid,
      attestationType:'none',
      authenticatorSelection:{residentKey:'required',userVerification:'required'},
      excludeCredentials,
    });
    const requestId=makeRequestId();
    await challenges.doc(requestId).set({type:'register',challenge:options.challenge,
      uid:user.uid,expiresAt:Date.now()+expiryMs});
    return res.json({requestId,options});
  }
  if(path==='/webauthn/register/verify'){
    const user=await requireOwner(req);
    const record=await takeChallenge(body.requestId,'register');
    if(record.uid!==user.uid)throw Error('wrong account');
    if(!body.credential||!take(body.credential.id,1024))throw Error('invalid credential');
    const v=await verifyRegistrationResponse({
      response:body.credential,expectedChallenge:record.challenge,
      expectedOrigin:origin,expectedRPID:rpId,requireUserVerification:true
    });
    if(!v.verified||!v.registrationInfo?.credential)throw Error('verification failed');
    const c=v.registrationInfo.credential;
    const ref=credentials.doc(c.id);
    await firestore.runTransaction(async tx=>{
      const old=await tx.get(ref);
      if(old.exists)throw Error('credential already registered');
      tx.create(ref,{uid:user.uid,publicKey:Buffer.from(c.publicKey).toString('base64url'),
        counter:c.counter,transports:body.credential.response.transports||[],
        createdAt:admin.firestore.FieldValue.serverTimestamp()});
    });
    return res.json({verified:true});
  }
  if(path==='/webauthn/login/options'){
    // Discoverable credentials prevent storing a public email-to-credential list
    const options=await generateAuthenticationOptions({
      rpID:rpId,userVerification:'required',allowCredentials:[],
    });
    const requestId=makeRequestId();
    await challenges.doc(requestId).set({type:'login',challenge:options.challenge,
      expiresAt:Date.now()+expiryMs});
    return res.json({requestId,options});
  }
  if(path==='/webauthn/login/verify'){
    const record=await takeChallenge(body.requestId,'login');
    const assertion=body.credential;
    if(!assertion||!take(assertion.id,1024))throw Error('invalid credential');
    const ref=credentials.doc(assertion.id);
    const doc=await ref.get();
    if(!doc.exists||doc.data().uid!==ownerUid)throw Error('credential not recognized');
    const saved=doc.data();
    const v=await verifyAuthenticationResponse({
      response:assertion,expectedChallenge:record.challenge,
      expectedOrigin:origin,expectedRPID:rpId,requireUserVerification:true,
      credential:{id:doc.id,publicKey:Buffer.from(saved.publicKey,'base64url'),
        counter:saved.counter,transports:saved.transports||[]}
    });
    if(!v.verified)throw Error('invalid signature');
    // The counter is best-effort anti-clone telemetry; do not revoke zero-counter synced passkeys
    await ref.update({counter:v.authenticationInfo.newCounter,
      lastUsedAt:admin.firestore.FieldValue.serverTimestamp()});
    const firebaseCustomToken=await admin.auth().createCustomToken(ownerUid);
    return res.json({firebaseCustomToken});
  }
  return failure(res,404,'Unknown route');
}
exports.musicPasskeyApi=onRequest({
  region:REGION,
  cors:[origin],
  maxInstances:3,
  invoker:'public',
  memory:'256MiB'
},async(req,res)=>{
  try{await dispatch(req,res)}
  catch(e){
    console.error('Passkey API error',e.name||'Error');
    const expected=['unauthorized','forbidden','expired challenge','bad request',
      'wrong account','invalid credential','credential already registered',
      'credential not recognized','verification failed','invalid signature','wrong origin'];
    failure(res,expected.includes(e.message)?400:500,'Passkey authentication failed');
  }
});
