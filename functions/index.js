'use strict';

// [START import]
const functions = require('firebase-functions');
const path = require('path');
const os = require('os');
const fs = require('fs');
const archiver = require('archiver');
const crypto = require("crypto");

// The Firebase Admin SDK to access the Firebase Realtime Database.
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);
var db = admin.firestore();
const settings = {/* your settings... */ timestampsInSnapshots: true};
db.settings(settings);

var braintree = require("braintree");

const predsPerDay = 10;

var gateway = braintree.connect({
    environment:  braintree.Environment.Sandbox,
    merchantId:   'jzxwzcfzknq5py6w',
    publicKey:    'xvfv6z5nhk2t2np6',
    privateKey:   '745d4f3a0e7602993da8d10a3c484243'
});

const latestVersion = "0.0.1";
const latestVersionURL = "http://www.lul.com/download"


exports.completePairing = functions.https.onCall((data, context) => {

  if (!context.auth) {
    // Throwing an HttpsError so that the client gets the error details.
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
        'while authenticated.');
  }

  const uid = context.auth.uid;

  let payload = {
    notification: {
      title: 'PAIRING SUCCESSFUL'
    }
  };

  return getUser(uid)
  .then(user_record =>
  {
    db.collection('users').doc(uid).set({paired: true}, { merge: true});
    return admin.messaging().sendToDevice(user_record.device_id, payload);
  });
});

exports.getCustomToken = functions.https.onCall((data, context) =>
{
  var uid = data.uid;
  var auth_secret = data.auth_secret;

  var userAuthRef = db.collection('users').doc(uid).collection("secret").doc("auth_secret");
  console.log("Now trying to find auth secret for user: "+uid);


  return userAuthRef.get()
  .catch(err =>
  {
    console.log('Error obtaining user auth: '+err);
    return Promise.reject(err);
  })
  .then(doc =>
  {
    console.log('Finished retrieving doc');
    if (!doc.exists)
    {
      console.log('No such user auth!');
      throw new Error('User auth does not exist');
    }
    else
    {
      var data = doc.data();
      console.log("this is the result for the user: "+JSON.stringify(data));
      return data;
    }
  })
  .catch(err =>
  {
    console.log('Error obtaining user auth: '+err);
    return Promise.reject(err);
  })
  .then(user_rec =>
  {
    if(user_rec.auth_secret === auth_secret)
      return admin.auth().createCustomToken(uid);
    else {
      throw new Error("Wrong auth_secret.");
    }
  })
  .then(customToken => {
    return customToken;
  })
  .catch( err => {
    console.log("Error creating custom token:", err);
    return err
  });
});


exports.client_token = functions.https.onCall((data, context) => {

  if (!context.auth) {
    // Throwing an HttpsError so that the client gets the error details.
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
        'while authenticated.');
  }

  var uid = context.auth.uid;

  return getUser(uid)
  .then(user_rec =>
  {
    return uid2bt_id(user_rec);
  })
  .then(bt_id =>
  {
    return gateway.clientToken.generate({customerId: bt_id});
  })
  .catch( err =>
  {
    console.log('User does not have a bt_id');
    console.log(err);
    return gateway.clientToken.generate();
  })
  .then(response =>
  {
    if(response.success)
    {
      var clientToken = response.clientToken;
      console.log('client token sent');
      return response.clientToken;
    }
    else
    {
        console.log('Error obtaining clientToken');
        console.log(response.message);
        return response;
    }
  })
  .catch( err =>
  {
    console.log('Error obtaining clientToken');
    console.log(err);
    return err;
  });
});




exports.passUIDtoDesktop = functions.https.onCall((data, context) =>
{
  if (!context.auth) {
    // Throwing an HttpsError so that the client gets the error details.
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
        'while authenticated.');
  }

  const realtimeDBID = data.realtimeDBID;
  var db = admin.database();
  var ref = db.ref("uids");
  const uid = context.auth.uid;


  return ref.child(realtimeDBID).set({uid: uid, auth_secret:auth_secret})
  .then(response =>
  {
    console.log("Pairing successful");
    return "SUCCESS";
  })
  .catch(err =>
  {
    console.log("Pairing NOT successful");
    return err;
  });
});

exports.subscribe = functions.https.onCall((data, context) =>
{
  if (!context.auth)
  {
    // Throwing an HttpsError so that the client gets the error details.
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
        'while authenticated.');
  }

  var uid = context.auth.uid;

  var nonceFromTheClient = data.payment_method_nonce;
  console.log('This is the nonce: '+nonceFromTheClient);

  return getUser(uid)
  .then(user_rec =>
  {
    return uid2bt_id(user_rec);
  })
  .then(bt_id =>
  {
    console.log('customer already has a bt_id: '+bt_id);
    return gateway.customer.find(bt_id)
    .then(customer =>
    {
      var pmethods = customer.paymentMethods;
      console.log("customer already exists");
      console.log(pmethods);
      pmethods.sort((a, b) => {
            var keyA = new Date(a.updated_at),
                keyB = new Date(b.updated_at);
            // Compare the 2 dates
            if(keyA < keyB) return -1;
            if(keyA > keyB) return 1;
            return 0;
        }).reverse();
      var most_recent_p = pmethods[0];
      console.log("pmethods after");
      console.log(pmethods);

      console.log("We picked this one:");
      console.log(most_recent_p);

      return gateway.subscription.create({
        paymentMethodToken: most_recent_p.token,
        planId: "premium_subscription"
      });
    })
    .catch( err=>
    {
      console.log(err);
      throw new functions.https.HttpsError('failed-precondition', 'braintree user not found');
    })
    .then(result =>
    {
      if (result.success)
      {
        console.log('Success!: '+JSON.stringify(result));
        return "SUCCESS";
      }
      else
      {
        console.log('Payment not successful: '+result.message);
        throw new functions.https.HttpsError('subscribe-error', 'Checkout unsuccessful: '+err.message);
      }
    })
    .catch(err =>
    {
      console.log('subscribe error');
      throw err;
    });
  })
  .catch(err =>
  {
      console.log('Customer does not exist yet');
      // create new customer
      return gateway.customer.create({paymentMethodNonce: nonceFromTheClient})
      .then( result =>
      {
        console.log("Then: "+JSON.stringify(result));
         if(result.success)
         {
           console.log('New Customer successfully created');
           console.log('This is the customer id: '+result.customer.id);

           var userRef = db.collection('users').doc(uid);
           console.log("Now trying to find user: "+uid);
           var customer = result;
           // add bt_id to firestore
           userRef.update({bt_id: result.customer.id});
           return gateway.subscription.create({
             paymentMethodToken: result.customer.paymentMethods[0].token,
             planId: "premium_subscription"
           })
         }
         else
         {
           console.log('Error creating user');
           throw new functions.https.HttpsError('user-create', 'Failed to create user');
         }
       })
       .catch( err =>
       {
         console.log('Error creating user: '+err);
         throw err;
       })
       .then(result =>
       {
         if(result.success)
         {
           console.log('Successfully created new subscriptions!');
           return "SUCCESS";
         }
         else
         {
           console.log('Error creating new subscription');
           throw new functions.https.HttpsError('subscribe-error', 'Checkout unsuccessful: ');
         }
       })
       .catch(error =>
       {
         console.log('subscribe error: '+err.message);
         throw error;
       });
  });
});

function getSubsForCustomer(bt_id)
{
  return new Promise((resolve, reject) =>
  {
    if(bt_id === null)
      return reject(new Error("bt_id was null"));
    return gateway.customer.find(bt_id, (err, customer) =>
    {
      if(!err)
      {
        console.log('Found customer');
        var pmethods = customer.paymentMethods;
        var subs = [];
        for(var i=0; i<pmethods.length; ++i)
          subs = subs.concat(pmethods[i].subscriptions);
        console.log("Found these subs");
        console.log(subs);
        return resolve(subs);
      }
      else
      {
        console.log('no active subscriptions, couldnt even find the customer');
        console.log(err);
        return reject(new Error('no active subscriptions, couldnt even find the customer'));
      }
    });
  })
}

function hasActiveSub(bt_id)
{
  console.log("trying to find customer: "+bt_id);

  return new Promise((resolve, reject) =>
  {
    getSubsForCustomer(bt_id).then(subs =>
    {
      for(var i=0; i<subs.length; ++i)
      {
        var subscription = subs[i];
        if(subscription.status === braintree.Subscription.Status.Active
         //  || (subscription.status == braintree.Subscription.Status.PastDue
         // && subscription.daysPastDue <= 5
       )
        {
          console.log("Found active subscription");
          console.log(subscription);
          return resolve(true);
        }
      }
      console.log("Didnt find active subscription for the customer");
      return reject(new Error("Didnt find active subscription for the customer"));
    })
    .catch(error =>
    {
      console.log("ERROR: couldn't find the user "+error.message);
      return reject(new Error("ERROR: couldn't find the user "+error.message));
    });
  });
}

function getUser(uid)
{
  var userRef = db.collection('users').doc(uid);
  console.log("Now trying to find user: "+uid);

  return new Promise( (resolve, reject) =>
  {
    return userRef.get().
    then(doc =>
    {
      console.log('Finished retrieving doc');
      if (!doc.exists)
      {
        console.log('No such user!');
        return reject(new Error('User does not exist'));
      }
      else
      {
        var data = doc.data();
        console.log("this is the result for the user: "+JSON.stringify(data));
        return resolve(data);
      }
    })
    .catch(error =>
    {
      console.log("ERROR: couldn't find the user "+error.message);
      return reject(new Error('User does not exist'));
    });
  });
}

function uid2bt_id(user_record)
{
  return new Promise( (resolve, reject) =>
  {
    if ('bt_id' in user_record)
    {
      return resolve(user_record.bt_id);
    }
    else
    {
      return reject(new Error('User does not have a braintreeuid'));
    }
  });
}

// checks if user has a valid subscription and if not sends back the number of predictions left for the day
exports.isValid = functions.https.onCall((data, context) =>
{
  if (!context.auth) {
    // Throwing an HttpsError so that the client gets the error details.
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
        'while authenticated.');
  }

  var uid = context.auth.uid;
  var currentVersion = null;
  var device_id = null;
  if('device_id' in data) device_id = data.device_id;
  if('current_version' in data) currentVersion = data.current_version;
  var user_record = null;
  var userRef = db.collection('users').doc(uid);
  var return_result = {};
  if(currentVersion !== null && currentVersion !== latestVersion)
    return_result["latest_version"] = latestVersionURL;

  return getUser(uid)
  .then(user_rec =>
  {
    user_record = user_rec;
    return_result["paired"] = user_record.paired ? "true": "false";
    if(device_id !== null) userRef.set({device_id: device_id}, { merge: true});
    return uid2bt_id(user_rec);
  })
  .then(bt_id =>
  {
    console.log("result for uid2bt was: "+bt_id);
    return hasActiveSub(bt_id);
  })
  .then(isActive =>
  {
    return_result["subscribed"] = "true";
    return return_result;
  })
  .catch(err =>
  {
    console.log('customer is not active: '+err);
    return_result["subscribed"] = "false";
    if(user_record !== null)
      return getNumPredLast24(uid)
        .then(querySnapshot =>
        {
          console.log(querySnapshot);
          console.log("number of preds in last 24h: "+querySnapshot.size);
          var left = Math.max(0,predsPerDay - (querySnapshot.size));
          console.log("# of preds left is: "+left.toString());
          return_result["remaining"] = left.toString();
          return return_result;
        })
        .catch(error =>
        {
            console.log("ERROR: querysnapshot "+error);
            return error;
        });
    else
    {
      console.log("Creating new user");
      const auth_secret = crypto.randomBytes(1024).toString("hex");
      userRef.set(device_id !== null ? {device_id: device_id, paired: false} : {paired: false});
      userRef.collection("secret").doc("auth_secret").set({auth_secret:auth_secret});
      return_result["remaining"] = "10";
      return return_result;
    }
  });
});

exports.cancelSub = functions.https.onCall((data, context) => {
  if (!context.auth) {
    // Throwing an HttpsError so that the client gets the error details.
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
        'while authenticated.');
  }

  var uid = context.auth.uid;

  return getUser(uid)
  .then(user_rec =>
  {
    return uid2bt_id(user_rec);
  })
  .then(bt_id =>
  {
    console.log("result for uid2bt was: "+bt_id);
    return getSubsForCustomer(bt_id);
  })
  .then(subs =>
  {
    for(var i=0; i<subs.length; ++i)
    {
      var subscription = subs[i];
      if(subscription.status !== braintree.Subscription.Status.Canceled
       //  || (subscription.status == braintree.Subscription.Status.PastDue
       // && subscription.daysPastDue <= 5
      )
      {
        console.log("canceling this sub");
        gateway.subscription.cancel(subscription.id);
      }
    }
    return true;
  })
  .catch(error =>
  {
    console.log("ERROR: couldn't find the user "+error.message);
    return false;
  });
});

function getNumPredLast24(UID)
{
  var cutoff = new Date();
  var days = 1;
  cutoff.setDate(cutoff.getDate() - days);
  console.log("This is our UID: "+UID);
  const userRef = db.collection('users').doc(UID);
  console.log("getting number now ");
  return userRef.collection('predictions').where('timestamp', '>=', cutoff).get();
}

exports.getRemainingPreds = functions.https.onCall((data, context) => {
  if (!context.auth) {
    // Throwing an HttpsError so that the client gets the error details.
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
        'while authenticated.');
  }

  var uid = context.auth.uid;

  return getUser(uid)
  .then(user_record =>
  {
    return getNumPredLast24(uid);
  })
  .then(querySnapshot =>
  {
    console.log("number of preds in last 24h: "+querySnapshot.size);
    var left = Math.max(0,predsPerDay - (querySnapshot.size))
    console.log("# of preds left is: "+left.toString());
    return left.toString();
  })
  .catch(error =>
  {
      console.log("ERROR: querysnapshot "+error);
      return error;
  });
});


exports.relayMessage = functions.https.onCall((data, context) => {
  if (!context.auth) {
    // Throwing an HttpsError so that the client gets the error details.
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
        'while authenticated.');
  }

  const uid = context.auth.uid;
  const items = data.items.toString();

  // let payload = {data: {body: items}};

  let payload = {
    notification: {
      title: 'New items',
      body: items
    }
  };


  const newPredDB = {timestamp: new Date(), items: payload.notification.body};
  var device_id = null;
  var user_record = null;

  console.log("device_id: "+device_id);
  console.log("uid: "+uid);
  console.log("items: "+items);

  return getUser(uid)
  .then(user_rec =>
  {
    user_record = user_rec;
    device_id = user_record.device_id;
    return uid2bt_id(user_rec);
  })
  .then(bt_id =>
  {
    console.log("User has a bt_id");
    return hasActiveSub(bt_id);
  })
  .then(result =>
  {
    console.log("User has active sub");
    db.collection('users').doc(uid).collection('predictions').add(newPredDB);
    admin.messaging().sendToDevice(device_id, payload);
    return "SUCCESSFUL,1337";
  })
  // .catch(error => {
  //   console.log("ERROR: couldn't find the user "+error);
  //   res.status(500).send("Couldn't find user");
  //   throw new functions.https.HttpsError("Couldn't find user");
  // })
  .catch( err =>
  {
    console.log("User does NOT have active sub: "+err);
    return getNumPredLast24(uid)
    .then(querySnapshot =>
    {
      console.log("number of preds in last 24h: "+querySnapshot.size);
      if (querySnapshot.size >= 10)
      {
        console.log('querysnapshot >10');
        payload.notification.body = "-1";
        admin.messaging().sendToDevice(device_id, payload);
        return "LIMIT REACHED";
      }
      else
      {
        console.log('querysnapshot <10');
        console.log("device_id: "+device_id)
        admin.messaging().sendToDevice(device_id, payload);
        db.collection('users').doc(uid).collection('predictions').add(newPredDB);
        return "SUCCESSFUL,"+(predsPerDay-querySnapshot.size);
      }
    })
    .catch(err =>
    {

      console.log("Error occurred: UID DOES NOT EXIST");
      return err;
    })
  })

});


exports.pay = functions.https.onRequest((req, res) => {

  var client_token = req.body.client_token;

  console.log("In pay function:\n");
  console.log("This is the client token:\n");
  console.log(client_token);
  const filePath = "bt.html";
  if (fs.existsSync(filePath)) {
    console.log('File exists!');
  }
  else {
    console.log('File does not exists!');
  }


  fs.readFile(filePath, 'utf8',  (err, contents) => {
    if(err) {
        console.log("Error: "+err);
        return res.status(500).send(err);
    }
    return res.status(200).send(contents.replace("MY_CLIENT_TOKEN", client_token));
  });
});

exports.generateDownload = functions.https.onRequest((req, res) => {

  const filePath = "leagueIQ.png";
  console.log('LOL!')

  const bucket = admin.storage().bucket();


  const device_id = "12345";
  const dev_id_file_name = crypto.randomBytes(16).toString("hex");

  const temp_dir_remote = crypto.randomBytes(16).toString("hex");
  const fileName_remote = "setup.zip";
  const remote_filepath = path.join(temp_dir_remote, fileName_remote);

  if (fs.existsSync(filePath)) {
    console.log('File exists!');
  }
  else {
    console.log('File does not exists!');
  }

  // fs.writeFile(path.join(os.tmpdir(), filePath), "54321", function (err) {
  //   if (err) throw err; else console.log('File written!');

  fs.writeFile(path.join(os.tmpdir(), dev_id_file_name), device_id, (err) => {
    if (err) throw err;
    console.log('Saved!');

  const zip_name = crypto.randomBytes(16).toString("hex");
  var zip_output = fs.createWriteStream(path.join(os.tmpdir(), zip_name));
  var archive = archiver('zip', {
      store: true // Sets the compression method to STORE.
  });
  console.log('Starting archive!');
  archive.on('error', (err) => {
    throw err;
  });

  // pipe archive data to the output file
  archive.pipe(zip_output);

  archive.on('warning', rej);
  archive.on('error', rej);

  function rej(err) {
      archive.abort();
      console.log('err ', err);
      return false;
  }

  // append files
  archive.file(filePath, {name: 'setup.exe'});
  archive.file(path.join(os.tmpdir(), dev_id_file_name), {name: 'dev_id.txt'});
  console.log('Archive almost finished');
  //
  return archive.finalize()
    .then(() => {
    console.log('Archive created');
    // We add a 'thumb_' prefix to thumbnails file name. That's where we'll upload the thumbnail.

    // Uploading the thumbnail.
    console.log('Now uploading');

    if (fs.existsSync(path.join(os.tmpdir(), zip_name))) {
      console.log('zip File exists!');
    }
    else {
      console.log('zip File does not exists!');
    }

    // var storageRef = firebase.storage().ref();
    // var ref = storageRef.child(path.join(os.tmpdir(), zip_name));
    // return ref.put(zip_output);

    return bucket.upload(path.join(os.tmpdir(), zip_name), {
      destination: remote_filepath,
      resumable: false
    });
    // Delete the local file to free up disk space.
  }).catch(err => {
  console.log("SHITS FUCKED")
  throw new Error('Higher-level error. ' + err.message);
}).then(() => fs.unlinkSync(path.join(os.tmpdir(), dev_id_file_name)))
  .then(() => fs.unlinkSync(path.join(os.tmpdir(), zip_name)))
  .then(() => {
    console.log('Upload complete');
    const remote_file = bucket.file(remote_filepath);
    return remote_file.getSignedUrl({
      action: 'read',
      expires: '03-09-2491'
    });
  }).then(signedUrls => {
      console.log('Now serving page');

      return res.status(200).send(`<!doctype html>
          <head>
            <title>League IQ Download link</title>
          </head>
          <body>
            ${"Click here to download the Desktop client: " + signedUrls[0]}
          </body>
        </html>`);

    });
  });
  // [END thumbnailGeneration]
});
// [END generateThumbnail]
// });
