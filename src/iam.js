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



module.exports = {
  describeRole
};
