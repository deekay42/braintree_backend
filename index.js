'use strict';

// [START import]
const functions = require('firebase-functions');
const gcs = require('@google-cloud/storage')();
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

exports.client_token = functions.https.onCall((data, context) => {

  if (!context.auth) {
    // Throwing an HttpsError so that the client gets the error details.
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
        'while authenticated.');
  }

  console.log(context.auth.uid);

  return uid2bt_id(context.auth.uid, bt_id => {
    return gateway.clientToken.generate({customerId: bt_id})
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
});

exports.subscribe = functions.https.onCall((data, context) => {

  if (!context.auth) {
    // Throwing an HttpsError so that the client gets the error details.
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
        'while authenticated.');
  }

  var uid = context.auth.uid;

  var nonceFromTheClient = data.payment_method_nonce;
  console.log('This is the nonce: '+nonceFromTheClient);


  return gateway.customer.find(uid, (err, customer) =>
  {
    // Customer doesnt exist yet
    if(err)
    {
      // create new customer
      return gateway.customer.create({paymentMethodNonce: nonceFromTheClient})
        .then( result =>
        {
           if(result.success)
           {
             console.log('This is the customer id: '+result.customer.id);

             var userRef = db.collection('users').doc(uid);
             console.log("Now trying to find user: "+uid);
             var customer = result;
             // add bt_id to firestore
             return userRef.update({bt_uid: result.customer.id});
           }
           else
           {
             throw new functions.https.HttpsError('user-create', 'Failed to create user');
           }
         })
         .catch( err =>
         {
           console.log('error: '+err);
           throw err;
         })
         .then(doc =>
         {
           if (!doc.exists)
           {
             throw new functions.https.HttpsError('no-such-user', 'Couldn\'t find user');
           }
           else
           {
             console.log("Successfully updated bt_id");
             return gateway.subscription.create({
               paymentMethodToken: result.customer.paymentMethods.token,
               planId: "premium_subscription"
             })
           }
         })
         .catch(error =>
         {
           console.log("ERROR: couldn't find the user "+error.message);
           throw error;
         })
         .then(result =>
         {
           if(result.success)
           {
             console.log('Success!');
             return result;
           }
           else
           {
             throw new functions.https.HttpsError('subscribe-error', 'Checkout unsuccessful: ');
           }
         })
         .catch(error =>
         {
           console.log('subscribe error: '+err.message);
           throw error;
         });
    }
    else
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
      })
      .then(result =>
      {
            if (result.success)
            {
              console.log('Success!');
              return result;
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
    }
  });
});

function hasActiveSub(uid, callback)
{
  if(uid === null)
    return callback(false);
  console.log("trying to find customer: "+uid);
  return gateway.customer.find(uid, (err, customer) =>
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
      for(i=0; i<subs.length; ++i)
      {
        var subscription = subs[i];
        if(subscription.status === braintree.Subscription.Status.Active
         //  || (subscription.status == braintree.Subscription.Status.PastDue
         // && subscription.daysPastDue <= 5
       )
        {
          console.log("Found active subscription");
          console.log(subscription);
          return callback(true);
        }
      }
      console.log("Didnt find active subscription for the customer");
      return callback(false);
    }
    else
    {
      console.log('no active subscriptions, couldnt even find the customer');
      console.log(err);
      return callback(false);
    }
  });
}


function uid2bt_id(uid, callback)
{
  var userRef = db.collection('users').doc(uid);
  console.log("Now trying to find user: "+uid);

  return userRef.get().then(doc =>
  {
    if (!doc.exists)
    {
      console.log('No such user!');
      callback(null);
      return false;
    }
    else
    {
      var data = doc.data();
      console.log("this is the result for the user: "+JSON.stringify(data));

      if ('braintreeUID' in data)
      {
        return callback(data.braintreeUID);
      }
      else
      {
        return callback(null);
      }
    }
  })
  .catch(error => {
    console.log("ERROR: couldn't find the user "+error);
    callback(null);
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

  var uid = data.customer_id;

  return uid2bt_id(uid, bt_id =>
  {
    console.log("result for uid2bt was: "+bt_id);
    if(bt_id === null)
    {
      console.log("the bt_id is null");
      return getNumPredLast24(uid, (number) =>
      {
        var left = predsPerDay - number;
        console.log("# of preds left is: "+left.toString());
        return left.toString();
      });
    }
    else
    return hasActiveSub(bt_id, isActive =>
    {
      if(isActive)
      {
        return true;
      }
      else
      {
        return getNumPredLast24(uid, (number) =>
        {
          var left = predsPerDay - number;
          console.log("# of preds left is: "+left.toString());
          return left.toString();
        });
      }
    });
  });
});

function cancelAllSubs(subs)
{
  for(var i=0; i<subs.length; ++i)
  {
    gateway.subscription.cancel(subs[i].id);
  }
}

function getNumPredLast24(UID, callback)
{
  var cutoff = new Date();
  var days = 1;
  cutoff.setDate(cutoff.getDate() - days);

  console.log("This is our UID: "+UID);

  var predictionsRef = db.collection('users').doc(UID).collection('predictions');
  var last24hpredictions = predictionsRef.where('timestamp', '>=', cutoff);

  console.log("getting number now ");

  return last24hpredictions.get().
    then(querySnapshot =>
    {
      console.log("number of preds in last 24h: "+querySnapshot.size);
      return callback(querySnapshot.size);
    })
    .catch(error =>
    {
        console.log("ERROR: querysnapshot "+error);
        return error;
    });
}

exports.getRemainingPreds = functions.https.onCall((data, context) => {
  const customerID = data.customer_id;

  return getNumPredLast24(customerID, (number) =>
  {
    var left = predsPerDay - number;
    console.log("# of preds left is: "+left.toString());
    return left;
  });
});

exports.relayMessage = functions.https.onRequest((req, res) =>
{

  const customerID = req.body.customer_id;
  const items = req.body.items.toString();
  const device_id = req.body.device_id;
  let payload = {data: {body: items}};
  const newPredDB = {timestamp: new Date(), items: payload.data.body};

  console.log("device_id: "+device_id);

  return uid2bt_id(uid, bt_id =>
  {
    return hasActiveSub(bt_id, (result) =>
    {
      var predictionsRef = db.collection('users').doc(customerID).collection('predictions');
      if(result)
      {
        console.log("User has active sub");
        var addDoc = predictionsRef.add(newPredDB).then(ref =>
        {
          console.log('Added document with ID: ', ref.id);
          return true;
        });
        admin.messaging().sendToDevice(device_id, payload);
        res.status(200).send("SUCCESSFUL");
        return true;
      }
      else
      {
        console.log("User does NOT have active sub");
        return getNumPredLast24(customerID, (number) =>
        {
          if (number > 10)
          {
            console.log('querysnapshot >10');
            payload.data.body = "-1";
            admin.messaging().sendToDevice(device_id, payload);
            res.status(500).send("LIMIT REACHED");
            return false;
          }
          else
          {
            console.log('querysnapshot <10');
            console.log("device_id: "+device_id)
            return admin.messaging().sendToDevice(device_id, payload)
              .then( response => {
                console.log('Successfully sent message:', response);
                // console.log('error:', response.results[0].error);
                return predictionsRef.add(newPredDB).then(ref =>
                {
                  console.log('Added document with ID: ', ref.id);
                  res.status(200).send("SUCCESSFUL");
                  return true;
                });
              })
              .catch( error => {
                console.log('Error sending message:', error);
                throw error;
              });
          }
        });
      }
    });
  })
  .catch(error => {
    console.log("ERROR: couldn't find the user "+error);
    res.status(500).send("Couldn't find user");
  });
});
//
// exports.lul = functions.https.onRequest((req, res) => {
//   const bucket = storage.bucket('neuralleague');
//
//   storage.getBuckets().then(function(data) {
//     var buckets = data[0];
//     console.log(buckets.name);
//       return true;
//   })
//   // bucket.getFiles().then(function(data) {
//   //   var file = data[0];
//   //   console.log(file.name);
//   //   return true;
//   // })
//   .catch(err => {console.log("SHITS FUCKED YO"); console.log(err)})
//   ;
// });



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
