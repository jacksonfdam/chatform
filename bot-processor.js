var kue = require('kue');
var jobs = kue.createQueue({redis: process.env.REDIS_URL});
const mongoose = require('mongoose');
const Form = require('./models/Form');
const Responder = require('./models/Responder');
const Smooch = require('smooch-core');

String.prototype.replaceAll = function(search, replacement) {
    var target = this;
    return target.split(search).join(replacement);
};

/**
 * Connect to MongoDB.
 */
 mongoose.Promise = global.Promise;
 mongoose.connect(process.env.MONGODB_URI || process.env.MONGOLAB_URI);
 mongoose.connection.on('error', () => {
   console.log('%s MongoDB connection error. Please make sure MongoDB is running.');
   process.exit();
 });


  function sendSmoochMessage(s, appUser, message) {
    s.appUsers.typingActivity(appUser._id, {
      role:'appMaker',
      type:'typing:start'
    }).then((response) => {},(err) => {});

    //Are we sending a plain message?
    if(message && message.question) {
      if(message.answers.length) {
        var quickReplies = [];

        for(var i=0; i<message.answers.length; i++) {
          qr = {
            type: 'reply',
            text: message.answers[i],
            payload: message.answers[i]
          }

          quickReplies.push(qr);
        }

        return s.appUsers.sendMessage(appUser._id, {
            role: 'appMaker',
            type: 'text',
            text: message.question,
            actions: quickReplies
          });
    } else {
      //Recursive, because that's how I roll...
      return sendSmoochMessage(s, appUser, message.question);
    }
    } else {
      return s.appUsers.sendMessage(appUser._id, {
          role: 'appMaker',
          type: 'text',
          text: message
      })
    }
  }


    jobs.process("bot_dispatch", (job,done) => {
        //Look up responder
        const appUser = job.data.appUser;

        Form.findById(job.data.formId, (err, form) => {
          console.log("FORM ID: " + job.data.formId);

          if(err || !form || form == null) {
            console.log(job.data.formId + " FORM MIGHT BE NULL");
            console.log(err);
            done("couldn't find form");
          } else {

            //Log in to Smooch
            const smooch = new Smooch({jwt: form.smoochToken});
            Responder.findOne({'appUserId' : appUser._id}, (err, responder) => {
              if (err) {
                console.log(err);
                done();
              }

              if(!responder) {
                responder = new Responder({
                  formId: job.data.formId,
                  appUserId: appUser._id,
                  appUser: appUser
                });

                responder.response = {};
              } else {
                //The message contained an answer to something that we want to track!
                var questionIndex = 0;

                if(responder.response) {
                  questionIndex = Object.keys(responder.response).length;
                  if(questionIndex >= form.fields.length) {
                    done();
                  }
                } else {
                  responder.response = {};
                }

                if(form.fields[questionIndex] && form.fields[questionIndex].question) {

                  question = form.fields[questionIndex].question;
                  question = question.replaceAll('.', '\u{FF0E}');
                  question = question.replaceAll('$', '\u{FF04}');

                  console.log(form._id + " QUESTION: " + question);
                  console.log(form._id + " RESPONSE: \n " + JSON.stringify(responder.response, null, 2));

                  responder.response[question] = job.data.messageText;
                  responder.markModified('response');
                }
              }

              //console.log("SAVING RESPONDER: " + JSON.stringify(responder, null, 2));

              //Save response
              responder.save((err) => {
                if(err) {
                  console.log(err);
                  done();
                }

                console.log(form._id + " FORM LENGTH: " + form.fields.length);
                console.log(form._id + " RESPONSE LENGTH: " + Object.keys(responder.response).length);

                //Send next question or gtfo
                if(Object.keys(responder.response).length === form.fields.length) {
                  //All questions have been answered

                  Responder.count({formId: form._id}, (err, count) => {
                    form.responseCount = count;
                    form.save((err) => {
                      if(form.endMessage && form.endMessage.length) {
                        sendSmoochMessage(smooch, appUser, form.endMessage).then((response) => {
                          done();
                        }).catch((error) => {console.log(err); done();});
                      } else {
                        done();
                      }
                    });
                  });
                } else if(Object.keys(responder.response).length == 0) {
                  //Starting off the survey
                  if(form.startMessage && form.startMessage.length) {
                    sendSmoochMessage(smooch, appUser, form.startMessage).then((response) => {
                      sendSmoochMessage(smooch, appUser, form.fields[0]).then((response) => {
                        done();
                      }).catch((error) => {console.log(form._id + " SEND FIRST QUESTION ERROR " + err);  done();});
                    }).catch((error) => {console.log(form._id + " START MESSAGE ERROR " + err);  done();});
                  } else {
                    sendSmoochMessage(smooch, appUser, form.fields[0]).then((response) => {
                      done();
                    }).catch((error) => {console.log(form._id + " PATH B ERROR"); console.log(err); done();});
                  }
                } else {
                  //Mid survey!
                  sendSmoochMessage(smooch, appUser, form.fields[Object.keys(responder.response).length]).then((response) => {
                    done();
                  }).catch((error) => {console.log(form._id + " PATH C ERROR"); console.log(err); done();});
                }
              });
            });
        }
      });
    });
