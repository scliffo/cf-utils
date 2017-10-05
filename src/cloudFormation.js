'use strict';
let config = require('./config');
let s3 = require('./s3');
let fs = require('fs');
let inquirer = require('inquirer');
let { spawn } = require('child_process');

/**
 * Create/Update a stack. Automatically switches to cli if stack contains transforms (e.g. SAM)
 * @param name fully qualified stack name
 * @param script full path to stack template
 * @param parameters complete listing of stack inputs
 * @param review if stack exists and this is true, then generate change set and pause update pending reviewer direction
 * @return {Promise}
 */
function upsertStack(name, script, parameters, review) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(script)) {
      reject(new Error(`${filePath} does not exist!`));
    }

    let params = {
      StackName: name,
      TemplateBody: fs.readFileSync(script).toString(),
      Capabilities: [
        'CAPABILITY_IAM',
        'CAPABILITY_NAMED_IAM'
      ],
      Parameters: parameters
    };

    let updateOrDeploy = function () {
      return new Promise((resolve, reject) =>
        updateStack(params)
          .then(data => resolve(data))
          .catch(err => {
            if (err.toString().indexOf('UpdateStack cannot be used with templates containing Transforms') >= 0) {
              config.logger.info('Stack contains transforms, using aws cli to update stack...');
              resolve(deployStack(name, script, parameters));
            } else {
              reject(err);
            }
          })
      );
    };


    let cf = new config.AWS.CloudFormation();
    cf.describeStacks({StackName: name}, (err) => {
      if (err) {
        createStack(params)
          .then(result => {
            resolve(result);
          })
          .catch((err) => {
            if (err.toString().indexOf('CreateStack cannot be used with templates containing Transforms')>=0) {
              config.logger.info('Stack contains transforms, using aws cli to deploy stack...');
              resolve(deployStack(name, script, parameters))
            }
            reject(err);
          });
      } else {
        if (review) {
          config.logger.info('Stack exists, creating changeset for review...');
          createChangeSet(params)
            .then(cs => {
              if (cs) {
                config.logger.info({ChangeSet: cs});
                inquirer.prompt(
                  [{
                    type: 'confirm',
                    name: 'performUpdate',
                    message: 'Changes will be made to these resources. Do you want to update stack?',
                    default: false
                  }])
                  .then(response => {
                    config.logger.info('Cleaning up review change set....');
                    deleteChangeSet(params.StackName)
                      .then(() => {
                        if (response.performUpdate) {
                          config.logger.info('Reviewer has accepted updates, continuing with stack update...');
                          resolve(updateOrDeploy());
                        } else {
                          reject('Reviewer rejected stack update');
                        }
                      });
                  });
              } else {
                config.logger.info('There are no changes to apply, continuing....');
                resolve(pollStack(params));
              }
            });
        } else {
          config.logger.info('Stack exists, updating...');
          resolve(updateOrDeploy());
        }
      }
    });
  });
}

/**
 * Create a stack
 * @param params AWS createStack params
 * @return {Promise}
 */
function createStack(params) {
  return new Promise((resolve, reject) => {
    params.DisableRollback = true;
    let cf = new config.AWS.CloudFormation();
    cf.createStack(params, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(pollStack(params));
      }
    })
  });
}

/**
 * Update a stack
 * @param params AWS updateStack params
 * @return {Promise}
 */
function updateStack(params) {
  return new Promise((resolve, reject) => {
    let cf = new config.AWS.CloudFormation();
    cf.updateStack(params, (err) => {
      if (err) {
        if (err.toString().indexOf('No updates are to be performed') >= 0) {
          config.logger.info('There are no changes to apply, continuing....');
        } else {
          reject(err);
          return;
        }
      }
      resolve(pollStack(params));
    })
  });
}

/**
 * Create a change set for the specified stack (change set will be postfixed with -preview)
 * @param params AWS updateStack params
 * @return {Promise}
 */
function createChangeSet(params) {
  return new Promise((resolve, reject) => {
    params.ChangeSetName = params.StackName + '-preview';
    let cf = new config.AWS.CloudFormation();
    cf.createChangeSet(params, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(pollChangeSet(params));
      }
    })
  });
}

/**
 * Deploy stack with transforms using CLI.
 * @param name fully qualified stack name
 * @param script full path to stack template
 * @param parameters complete listing of stack inputs
 * @return {Promise}
 */
function deployStack(name, script, parameters) {
  return new Promise((resolve, reject) => {
    let params = '';
    if (parameters && parameters.length > 0) {
      for (let i = 0; i < parameters.length; i++) {
        params += `${parameters[i].ParameterKey}="${parameters[i].ParameterValue}" `;
      }
    }

    const cli = spawn('aws',
      [
        'cloudformation',         'deploy',
        '--profile',              config.AWS_PROFILE,
        '--region',               config.AWS_REGION,
        '--template-file',        script,
        '--stack-name',           name,
        '--capabilities',         'CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM',
        ' --parameter-overrides', params
      ],
      { shell: true}
    );

    let err = '';
    cli.stdout.setEncoding('utf8'); cli.stderr.setEncoding('utf8');
    cli.stdout.on('data', (data) => { console.log(data); });
    cli.stderr.on('data', (data) => { console.log(data); err += data; });
    cli.on('close', (code) => {
      if (code !== 0) {
        if (err.indexOf('No changes to deploy') >= 0) {
          config.logger.info('There are no changes to apply, continuing....');
        } else {
          reject('Stack deploy failed');
          return;
        }
      }
      resolve(describeStack(name));
    });
  });
}

/**
 * Describe stack
 * @param name fully qualified stack name
 * @return {Promise}
 */
function describeStack(name) {
  return new Promise((resolve, reject) => {
    let cf = new config.AWS.CloudFormation();
    cf.describeStacks({StackName : name}, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data.Stacks[0]);
      }
    });
  });
}

/**
 * Extract the outputs from a stack
 * @param name fully qualified stack name
 * @return {Promise.<TResult>}
 */
function describeOutput(name) {
  return describeStack(name)
    .then(data => data.Outputs.reduce((map, output) => {
      map[output.OutputKey] = output.OutputValue; return map;
      }, {})
    );
}


/**
 * Delete a stack (note: will automatically empty S3 buckets before running deleteStack operation)
 * @param name fully qualified stack name
 * @return {Promise}
 */
function deleteStack(name) {
  return new Promise((resolve, reject) => {
    let params = {
      StackName: name
    };
    let cf = new config.AWS.CloudFormation();
    cf.describeStacks({StackName: name}, (err, data) => {
      if (err) {
        if (err.message.indexOf('does not exist')) {
          config.logger.info('Stack already deleted or never existed.');
          resolve();
        }
        reject(err);
      } else {
        // Check for any S3 buckets and if found empty each bucket otherwise delete stack operation will fail
        let s3Operations = [];
        for (let i = 0; i < data.Stacks[0].Outputs.length; i++) {
          if (/.*Bucket/.test(data.Stacks[0].Outputs[i].OutputKey)) {
            s3Operations.push(new Promise((resolve) => {
              config.logger.info('Emptying S3 bucket', data.Stacks[0].Outputs[i].OutputValue);
              resolve(s3.emptyBucket(data.Stacks[0].Outputs[i].OutputValue));
            }))
          }
        }

        Promise.all(s3Operations)
          .then(() => {
            cf.deleteStack(params, (err) => {
              if (err) {
                reject(err);
              } else {
                resolve(pollStack(params));
              }
            });
          })
          .catch(err => reject(err));
      }
    });
  });
}

/**
 * Delete change set
 * @param name fully qualified underlying stack name for this change set (i.e. not change set name itself)
 * @return {Promise}
 */
function deleteChangeSet(name) {
  return new Promise((resolve, reject) => {
    let params = {
      ChangeSetName: name + '-preview',
      StackName: name
    };
    let cf = new config.AWS.CloudFormation();
    cf.deleteChangeSet(params, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(pollChangeSet(params));
      }
    });
  });
}

/**
 * Poll stack status. Used to wait for stack operations to complete.
 * @param params AWS updateStack/createStack params
 * @return {Promise}
 */
function pollStack(params) {
  return new Promise((resolve, reject) => {
    let cf = new config.AWS.CloudFormation();
    cf.describeStacks({StackName : params.StackName}, (err, data) => {
      if (err) {
        if (err.message.indexOf('does not exist')) {
          config.logger.info('Stack deleted or never existed.');
          resolve();
        } else {
          reject(err);
        }
      } else {
        let stack = data.Stacks[0];
        switch (stack.StackStatus) {
          case 'CREATE_COMPLETE':
          case 'UPDATE_COMPLETE':
            config.logger.info('Stack operation completed');
            resolve(data);
            return;
          case 'ROLLBACK_COMPLETE':
          case 'CREATE_FAILED':
          case 'UPDATE_FAILED':
          case 'DELETE_FAILED':
          case 'UPDATE_ROLLBACK_COMPLETE':
            config.logger.warn({StackDetails: data});
            reject(new Error('Stack operation failed'));
            return;
        }
        config.logger.info('Waiting for stack operation to complete. This may take some time - ' + stack.StackStatus);
        setTimeout(function () {
          resolve(pollStack(params));
        }, 5000);
      }
    });
  });
}

/**
 * Poll stack change set status. Used to wait for stack operations to complete.
 * @param params AWS updateStack params
 * @param params
 * @return {Promise}
 */
function pollChangeSet(params) {
  return new Promise((resolve, reject) => {
    let cf = new config.AWS.CloudFormation();
    cf.describeChangeSet({
      ChangeSetName : params.ChangeSetName, StackName: params.StackName}, (err, cs) => {
      if (err) {
        if (err.message.indexOf('does not exist')) {
          config.logger.info('Stack deleted or never existed.');
          resolve();
        } else {
          reject(err);
        }
      } else {
        switch (cs.Status) {
          case 'CREATE_COMPLETE':
          case 'UPDATE_COMPLETE':
          case 'DELETE_COMPLETE':
            config.logger.info('Change set created');
            resolve(cs);
            return;
          case 'FAILED':
            if (cs.StatusReason.indexOf("didn't contain changes")) {
              config.logger.info('No updates are to be performed');
              resolve();
            } else {
              config.logger.warn({ChangeSet: cs});
              reject(new Error('Changeset creation failed'));
            }
            return;
        }
        config.logger.info('Waiting for change set to be created - ' + cs.Status);
        setTimeout(function () {
          resolve(pollChangeSet(params));
        }, 5000);
      }
    });
  });
}







module.exports = {
  upsertStack,
  createStack,
  updateStack,
  deployStack,
  describeStack,
  describeOutput,
  deleteStack,
  pollStack,
  pollChangeSet,
  createChangeSet,
  deleteChangeSet,
};
