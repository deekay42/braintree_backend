'use strict';

// [START import]
const functions = require('firebase-functions');
let fs;
let crypto;

// The Firebase Admin SDK to access the Firebase Realtime Database.
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);
const db = admin.firestore();
const settings = {/* your settings... */ timestampsInSnapshots: true};
db.settings(settings);

const braintree = require("braintree");

const predsPerDay = 10;

const gateway = braintree.connect({
    environment:  braintree.Environment.Sandbox,
    merchantId:   'jzxwzcfzknq5py6w',
    publicKey:    'xvfv6z5nhk2t2np6',
    privateKey:   '745d4f3a0e7602993da8d10a3c484243'
});

const latestVersion = "0.0.1";
const latestVersionURL = "http://leagueiq.gg/download";



exports.completePairing = functions.https.onCall((data, context) =>
{
  if (!context.auth) {
    // Throwing an HttpsError so that the client gets the error details.
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
        'while authenticated.');
  }

  const uid = context.auth.uid;

// exports.completePairing = functions.https.onRequest((req, res) => {
// const uid = "0daMo7V82hM7VUmWbbBtGEYBajQ2";
  var device_id;
  // let payload = {
  //   notification: {
  //           title: 'PAIRING SUCCESSFUL',
  //           click_action: 'FLUTTER_NOTIFICATION_CLICK'
  //         }
  // };

  // const options = {
  //   priority: 'high',
  //   timeToLive: 10
  // };

  // console.log("THIS IS THE UID: "+uid);

  return getUser(uid)
  .then(user_record =>
  {
    // device_id = user_record.device_id;
    // console.log("got the device id");
    // console.log(device_id);
    // payload["token"] = device_id;

    return db.collection('users').doc(uid).set({paired: true}, { merge: true});
  });
  // .then( result =>
  // {
  //   console.log("updated the DB");
  //   // return admin.messaging().sendToDevice(device_id, payload, options);
  //   // return admin.messaging().send(payload);
  // })
  // .then(result => { console.log("sent the msg: ", result); return true;})
  // .catch(err => {console.log(err); return false;});
});


exports.unpair = functions.https.onCall((data, context) =>
{
  if (!context.auth) {
    // Throwing an HttpsError so that the client gets the error details.
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
        'while authenticated.');
  }

  const uid = context.auth.uid;

  return getUser(uid)
  .then(user_record =>
  {
    return db.collection('users').doc(uid).set({paired: false}, { merge: true});
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
  var realtimeDB = admin.database();
  var ref = realtimeDB.ref("uids");
  const uid = context.auth.uid;
  const authRef = db.collection('users').doc(uid).collection("secret").doc("auth_secret");
  var auth_secret;

  return authRef.get().
  then(doc =>
  {
    if (!doc.exists)
    {
      console.log('No auth secret found!');
      throw new Error('Auth secret does not exist');
    }
    else
    {
      auth_secret = doc.data();
      auth_secret = auth_secret.auth_secret;
      console.log("Auth secret is: ");
      console.log(auth_secret);

      return ref.child(realtimeDBID).once("value");
    }
  })
  .then(snapshot =>
  {
    if(snapshot.exists()){
      console.log("db entry exists");
        return ref.child(realtimeDBID).update({uid: uid, auth_secret:auth_secret});
    }else{
      console.log("db entry does not exist");
        throw new Error('DB Ref does not exist');
    }
  })
  .then(response =>
  {
    return db.collection('users').doc(uid).set({paired: true}, { merge: true});
  })
  .then(response =>
  {
    console.log("Pairing successful");
    return "SUCCESS";
  })
  .catch(err =>
  {
    console.log(err);
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
      console.log('braintree user not found');
      return 'braintree user not found';
    })
    .then(result =>
    {
      if (result.success)
      {
        return db.collection('users').doc(uid).set({subscribed: true}, {merge: true});
      }
      else
      {
        console.log('Payment not successful: '+result.message);
        return  'Checkout unsuccessful';
      }
    })
    .then(result =>
    {
      console.log('Success!: '+JSON.stringify(result));
      return "SUCCESS";
    })

    .catch(err =>
    {
      console.log('subscribe error');
      console.log(err);
      return 'subscribe error';
    });
  })
  .catch(err =>
  {
      var newCustomer;
      console.log(err);
      console.log('Customer does not exist yet');
      // create new customer
      return gateway.customer.create({paymentMethodNonce: nonceFromTheClient})
      .then( result =>
      {
        newCustomer = result;
        console.log("Then: "+JSON.stringify(result));
         if(result.success)
         {
           console.log('New Customer successfully created');
           console.log('This is the customer id: '+result.customer.id);

           var userRef = db.collection('users').doc(uid);
           console.log("Now trying to find user: "+uid);
           var customer = result;
           // add bt_id to firestore
           return userRef.update({bt_id: result.customer.id});
         }
         else
         {
           console.log('Error creating user');
           return 'Failed to create user';
         }
       })
       .then(result => {
         console.log("Now trying to create subscription");
        return gateway.subscription.create({
          paymentMethodToken: newCustomer.customer.paymentMethods[0].token,
          planId: "premium_subscription"
        })
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
           return 'Error creating new subscription';
         }
       })
       .catch(error =>
       {
          console.log(error);
          console.log('Error creating new subscription');
          return 'Error creating new subscription';
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
    return uid2bt_id(user_rec)
    .then(bt_id =>
      {
        console.log("result for uid2bt was: "+bt_id);
        return hasActiveSub(bt_id);
      })
      .then(isActive =>
      {
        return userRef.set({subscribed: true}, {merge: true});
      })
      .then(result => {
        return_result["subscribed"] = "true";
        return return_result;
      })
  })
  .catch(err =>
  {
    console.log('customer is not active: '+err);
    // TODO: for go live set this to return userRef.set({subscribed: false}, {merge: true})
    return userRef.set({subscribed: true}, {merge: true})
    .then(result => {
      //for go live...
      return_result["subscribed"] = "true";
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
        crypto = crypto || require("crypto");
        console.log("Creating new user");
        const auth_secret = crypto.randomBytes(1024).toString("hex");
        // for go live change this to: let data = device_id !== null ? {device_id: device_id, paired: false, subscribed: false} : {paired: false};
        let data = device_id !== null ? {device_id: device_id, paired: false, subscribed: true} : {paired: false};

        return userRef.set(data)
        .then(res =>
        {
            return userRef.collection("secret").doc("auth_secret").set({auth_secret:auth_secret})
            .then(r =>
            {
                return_result["remaining"] = "10";
                return return_result;
            });
        });

      }
    })
  });
});

exports.cancelSub = functions.https.onCall((data, context) => {
  if (!context.auth) {
    // Throwing an HttpsError so that the client gets the error details.
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
        'while authenticated.');
  }

  var uid = context.auth.uid;
  var user_rec;

  return getUser(uid)
  .then(myUser =>
  {
    user_rec = myUser;
    return db.collection('users').doc(uid).set({subscribed: false}, {merge: true});
  })
  .then(result =>{
    console.log("updated db record");
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
        return gateway.subscription.cancel(subscription.id)
        .then(result => {
          return true;
        });
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

exports.testConnection = functions.https.onCall((data, context) => {
  if (!context.auth) {
    console.log("testconnection autherror");
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
        'while authenticated.');
  }

  const uid = context.auth.uid;
  let payload = {
    data: {click_action: "FLUTTER_NOTIFICATION_CLICK", body: "success"}
  };

  const options = {
    priority: 'high',
    timeToLive: 10
  };

  return getUser(uid)
  .then(user_rec =>
  {
    return admin.messaging().sendToDevice(user_rec.device_id, payload, options).then( lol => {return "sent";});
  });
});

exports.subscribeSuccessful = functions.https.onCall((data, context) => {
  if (!context.auth) {
    console.log("subscribeSuccessful autherror");
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
        'while authenticated.');
  }

  const uid = context.auth.uid;
  let payload = {
    data: {click_action: "FLUTTER_NOTIFICATION_CLICK", body: "subscribe_success"}
  };



  const options = {
    priority: 'high',
    timeToLive: 10
  };

  return getUser(uid)
  .then(user_rec =>
  {
    return admin.messaging().sendToDevice(user_rec.device_id, payload, options).then( lol => {return "sent";});
  });
});


exports.relayMessage = functions.https.onCall((data, context) => {
  if (!context.auth) {
    console.log("relaymessage autherror");
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
        'while authenticated.');
  }

  const uid = context.auth.uid;
  const items = data.items.toString();

  // let payload;
  // if(items !== "-1")
  //   payload = {
  //     notification: {
  //             title: 'New item recommendation',
  //             click_action: 'FLUTTER_NOTIFICATION_CLICK'
  //           },
  //     data: {
  //      body: items
  //     },
  //   };
  // else
  //   payload = {
  //     notification: {
  //             title: 'Desktop connection established'
  //           }
  //   };



  //
  // const options = {
  //   priority: 'high',
  //   timeToLive: 10
  // };


  const newPredDB = {timestamp: new Date(), items: items};
  var device_id = null;
  var user_record = null;


  console.log("uid: "+uid);
  console.log("items: "+items);

  return getUser(uid)
  .then(user_rec =>
  {
    user_record = user_rec;
    device_id = user_record.device_id;
    console.log("device_id: "+device_id);
    if(user_record.subscribed)
    {
      console.log("User has active sub");

      return db.collection('users').doc(uid).collection('predictions').add(newPredDB)
      .then(lol =>
      {
        // return admin.messaging().sendToDevice(device_id, payload, options)
        // .then( lol => {return "SUCCESSFUL,1337";});
        return "SUCCESSFUL,1337";
      });


    }
    else
    {
      //TODO: need to replace sendtodevice with database update.
      console.log("User does NOT have active sub: ");
      return getNumPredLast24(uid)
      .then(querySnapshot =>
      {
        console.log("number of preds in last 24h: "+querySnapshot.size);
        var remaining = Math.max(0, predsPerDay - querySnapshot.size - 1).toString();
        // payload.notification.tag = remaining;
        if (querySnapshot.size >= predsPerDay)
        {
          console.log('querysnapshot >10');
          // payload.notification.body = "-1";
          // return admin.messaging().sendToDevice(device_id, payload, options)
          // .then(result => {
          //   return "LIMIT REACHED";
          // });
return "LIMIT REACHED"
        }
        else
        {
          console.log('querysnapshot <10');
          console.log("device_id: "+device_id)
          // return admin.messaging().sendToDevice(device_id, payload, options)
          // .then(result => {
          //   return db.collection('users').doc(uid).collection('predictions').add(newPredDB)
          //   .then(result =>{
          //     return "SUCCESSFUL,"+remaining;
          //   });
          // });
return "SUCCESSFUL,"+remaining;

        }
      })
      .catch(err =>
      {
        console.log("Error occurred: UID DOES NOT EXIST: " + err);
        return err;
      });
    }
  });

});


exports.getInviteCode = functions.https.onCall((data, context) =>
{
  if (!context.auth) {
    // Throwing an HttpsError so that the client gets the error details.
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
        'while authenticated.');
  }

  console.log("in getinvitecode");

  var code = data.invite_code;
  var uid = data.uid;
  console.log("code:");
  console.log(code);
  console.log("uid:");
  console.log(uid);

  var codeRef = db.collection('invite_codes').doc(code);
  console.log("Now trying to find code: "+code);

  return codeRef.get().
  then(doc =>
  {
    console.log('Finished retrieving doc');
    if (!doc.exists)
    {
      console.log('No such invite code!');
      return false;
    }
    else
    {
      var data = doc.data();
      console.log("this is the result for the invite code: "+JSON.stringify(data));
      if(data.hasOwnProperty("uid"))
      {
        if(uid === data.uid)
          return true;
        return false;
      }
      else
      {
        codeRef.set({uid: uid});
        return true;
      }
    }
  })
  .catch(error =>
  {
    console.log("ERROR: couldn't find the invite code"+error.message);
    return false;
  });

});



exports.pay = functions.https.onRequest((req, res) => {

  var client_token = req.body.client_token;
  fs = fs ||  require('fs');
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
