# complain if there is no argument
if [ $# -eq 0 ]; then
	echo "No arguments provided - please provide a file to convert"
	exit 1
fi

x=$1
y=${x%.mov}
echo "Converting $x to $y.gif"

ffmpeg -y -i $1 -filter_complex "fps=12,scale=1024:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=32[p];[s1][p]paletteuse=dither=bayer" $y.gif
