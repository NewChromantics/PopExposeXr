//	replace this with a proper mini unit test/api example set of scripts
Pop.Debug("Virtual Reality Test");


const Window = new Pop.Opengl.Window("VR!");

Window.OnRender = function (RenderTarget)
{
	RenderTarget.ClearColour(0, 1, 1);
}
//	find devices
//	attach to device
//	get updates
//	render
let Hmd = new Pop.Openvr.Hmd("Device Name", Window);

Hmd.OnPoses = function (Poses)
{
	function EnumPose(Pose, Index)
	{
		if (!Pose.IsConnected)
			return;
		Pop.Debug(`Device ${Index} connected; valid=${Pose.IsValidPose}`);
	}
	Poses.forEach(EnumPose);
	//Pop.Debug("New JS Poses x" + Poses.length);
}

Hmd.OnRender = function(RenderTarget,Camera)
{
	if ( Camera.Name == "Left" )
		RenderTarget.ClearColour( 1,0,0 );
	else if ( Camera.Name == "Right" )
		RenderTarget.ClearColour( 0,1,0 );
	else
		RenderTarget.ClearColour( 0,0,1 );
}
