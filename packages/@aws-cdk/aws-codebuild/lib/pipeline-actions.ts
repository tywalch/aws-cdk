import codepipeline = require('@aws-cdk/aws-codepipeline-api');
import iam = require('@aws-cdk/aws-iam');
import cdk = require('@aws-cdk/cdk');
import { ProjectRef } from './project';

/**
 * Common construction properties of all CodeBuild Pipeline Actions.
 */
export interface CommonCodeBuildActionProps {
  /**
   * The list of additional input Artifacts for this Action.
   */
  additionalInputArtifacts?: codepipeline.Artifact[];

  /**
   * The list of names for additional output Artifacts for this Action.
   * The resulting output artifacts can be accessed with the `additionalOutputArtifacts`
   * method of the Action.
   */
  additionalOutputArtifactNames?: string[];
}

/**
 * Common properties for creating {@link PipelineBuildAction} -
 * either directly, through its constructor,
 * or through {@link ProjectRef#addBuildToPipeline}.
 */
export interface CommonPipelineBuildActionProps extends CommonCodeBuildActionProps,
    codepipeline.CommonActionProps {
  /**
   * The source to use as input for this build.
   *
   * @default CodePipeline will use the output of the last Action from a previous Stage as input
   */
  inputArtifact?: codepipeline.Artifact;

  /**
   * The name of the build's output artifact.
   *
   * @default an auto-generated name will be used
   */
  outputArtifactName?: string;
}

/**
 * Construction properties of the {@link PipelineBuildAction CodeBuild build CodePipeline Action}.
 */
export interface PipelineBuildActionProps extends CommonPipelineBuildActionProps,
    codepipeline.CommonActionConstructProps {
  /**
   * The build project
   */
  project: ProjectRef;
}

/**
 * CodePipeline build Action that uses AWS CodeBuild.
 */
export class PipelineBuildAction extends codepipeline.BuildAction {
  constructor(parent: cdk.Construct, name: string, props: PipelineBuildActionProps) {
    // This happened when ProjectName was accidentally set to the project's ARN:
    // https://qiita.com/ikeisuke/items/2fbc0b80b9bbd981b41f

    super(parent, name, {
      provider: 'CodeBuild',
      artifactBounds: { minInputs: 1, maxInputs: 5, minOutputs: 0, maxOutputs: 5 },
      configuration: {
        ProjectName: props.project.projectName,
      },
      ...props,
    });

    setCodeBuildNeededPermissions(props.stage, props.project, true);

    handleAdditionalInputOutputArtifacts(props, this,
      // pass functions to get around protected members
      (artifact) => this.addInputArtifact(artifact),
      (artifactName) => this.addOutputArtifact(artifactName));
  }

  /**
   * Returns the additional output artifacts defined for this Action.
   * Their names will be taken from the {@link CommonCodeBuildActionProps#additionalOutputArtifactNames}
   * property.
   *
   * @returns all additional output artifacts defined for this Action
   * @see #additionalOutputArtifact
   */
  public additionalOutputArtifacts(): codepipeline.Artifact[] {
    return this._outputArtifacts.slice(1);
  }

  /**
   * Returns the additional output artifact with the given name,
   * or throws an exception if an artifact with that name was not found
   * in the additonal output artifacts.
   * The names are defined by the {@link CommonCodeBuildActionProps#additionalOutputArtifactNames}
   * property.
   *
   * @param name the name of the artifact to find
   * @returns the artifact with the given name
   * @see #additionalOutputArtifacts
   */
  public additionalOutputArtifact(name: string): codepipeline.Artifact {
    return findOutputArtifact(this.additionalOutputArtifacts(), name);
  }
}

/**
 * Common properties for creating {@link PipelineTestAction} -
 * either directly, through its constructor,
 * or through {@link ProjectRef#addTestToPipeline}.
 */
export interface CommonPipelineTestActionProps extends CommonCodeBuildActionProps,
    codepipeline.CommonActionProps {
  /**
   * The source to use as input for this test.
   *
   * @default CodePipeline will use the output of the last Action from a previous Stage as input
   */
  inputArtifact?: codepipeline.Artifact;

  /**
   * The optional name of the primary output artifact.
   * If you provide a value here,
   * then the `outputArtifact` property of your Action will be non-null.
   * If you don't, `outputArtifact` will be `null`.
   *
   * @default the Action will not have an output artifact
   */
  outputArtifactName?: string;
}

/**
 * Construction properties of the {@link PipelineTestAction CodeBuild test CodePipeline Action}.
 */
export interface PipelineTestActionProps extends CommonPipelineTestActionProps,
    codepipeline.CommonActionConstructProps {
  /**
   * The build Project.
   */
  project: ProjectRef;
}

export class PipelineTestAction extends codepipeline.TestAction {
  constructor(parent: cdk.Construct, name: string, props: PipelineTestActionProps) {
    super(parent, name, {
      provider: 'CodeBuild',
      artifactBounds: { minInputs: 1, maxInputs: 5, minOutputs: 0, maxOutputs: 5 },
      configuration: {
        ProjectName: props.project.projectName,
      },
      ...props,
    });

    // the Action needs write permissions only if it's producing an output artifact
    setCodeBuildNeededPermissions(props.stage, props.project, !!props.outputArtifactName);

    handleAdditionalInputOutputArtifacts(props, this,
      // pass functions to get around protected members
      (artifact) => this.addInputArtifact(artifact),
      (artifactName) => this.addOutputArtifact(artifactName));
  }

  /**
   * Returns the additional output artifacts defined for this Action.
   * Their names will be taken from the {@link CommonCodeBuildActionProps#additionalOutputArtifactNames}
   * property.
   *
   * @returns all additional output artifacts defined for this Action
   * @see #additionalOutputArtifact
   */
  public additionalOutputArtifacts(): codepipeline.Artifact[] {
    return this.outputArtifact === undefined
      ? this._outputArtifacts
      : this._outputArtifacts.slice(1);
  }

  /**
   * Returns the additional output artifact with the given name,
   * or throws an exception if an artifact with that name was not found
   * in the additonal output artifacts.
   * The names are defined by the {@link CommonCodeBuildActionProps#additionalOutputArtifactNames}
   * property.
   *
   * @param name the name of the artifact to find
   * @returns the artifact with the given name
   * @see #additionalOutputArtifacts
   */
  public additionalOutputArtifact(name: string): codepipeline.Artifact {
    return findOutputArtifact(this.additionalOutputArtifacts(), name);
  }
}

function setCodeBuildNeededPermissions(stage: codepipeline.IStage, project: ProjectRef,
                                       needsPipelineBucketWrite: boolean) {
  // grant the Pipeline role the required permissions to this Project
  stage.pipeline.role.addToPolicy(new iam.PolicyStatement()
    .addResource(project.projectArn)
    .addActions(
      'codebuild:BatchGetBuilds',
      'codebuild:StartBuild',
      'codebuild:StopBuild',
    ));

  // allow the Project access to the Pipline's artifact Bucket
  if (needsPipelineBucketWrite) {
    stage.pipeline.grantBucketReadWrite(project.role);
  } else {
    stage.pipeline.grantBucketRead(project.role);
  }
}

function handleAdditionalInputOutputArtifacts(props: CommonCodeBuildActionProps, action: codepipeline.Action,
                                              addInputArtifact: (_: codepipeline.Artifact) => void,
                                              addOutputArtifact: (_: string) => void) {
  if ((props.additionalInputArtifacts || []).length > 0) {
    // we have to set the primary source in the configuration
    action.configuration.PrimarySource = action._inputArtifacts[0].name;
    // add the additional artifacts
    for (const additionalInputArtifact of props.additionalInputArtifacts || []) {
      addInputArtifact(additionalInputArtifact);
    }
  }

  for (const additionalArtifactName of props.additionalOutputArtifactNames || []) {
    addOutputArtifact(additionalArtifactName);
  }
}

function findOutputArtifact(artifacts: codepipeline.Artifact[], name: string): codepipeline.Artifact {
  const ret = artifacts.find((artifact) => artifact.name === name);
  if (!ret) {
    throw new Error(`Could not find output artifact with name '${name}'`);
  }
  return ret;
}
