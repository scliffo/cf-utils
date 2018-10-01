'use strict';
let config = require('./config');


function describeRole(name) {
  return new Promise((resolve, reject) => {
    let iam = new config.AWS.IAM();
    var params = {
      RoleName: name
    };
    iam.getRole(params, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

function describeUser(name) {
  return new Promise((resolve, reject) => {
    let iam = new config.AWS.IAM();
    var params = {
      UserName: name
    };
    iam.getUser(params, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}


module.exports = {
  describeRole,
  describeUser
};
